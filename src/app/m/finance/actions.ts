"use server";

// 재무제표(수입·지출 장부) 서버 액션. 조회는 billing.view, 손대는 건 분류에 따라 갈린다:
// 인건비(payroll) 분류는 payroll.manage 가 있어야 넣고·고치고·지울 수 있고, 그 외 분류는
// billing.manage 면 된다 — 급여 축(payroll.*)은 관리자를 완전 차단하는 별개 권한 축이라
// (bootstrap.ts ADMIN_PERM_KEYS 주석 참고) 여기서도 그 경계를 그대로 지킨다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { can, guard, type Me } from "@/lib/auth";
import {
  FINANCE_CATEGORIES, PAYROLL_CATEGORY, isValidCategory, monthRange, trailingMonths,
  type FinanceDirection,
} from "@/lib/finance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

export type FinanceResult = { ok: true } | { ok: false; error: string };

function canManageCategory(me: Me, direction: FinanceDirection, category: string): boolean {
  if (category === PAYROLL_CATEGORY) return can(me, "payroll.manage");
  return can(me, "billing.manage") && isValidCategory(direction, category);
}

async function requireView(): Promise<Me> {
  return guard("billing.view");
}

// ---------------- 조회: 그 달 장부(손입력) + 도시락 자동 수입 + 12개월 추이 ----------------
export type LedgerRow = {
  id: string;
  date: string;
  direction: FinanceDirection;
  category: string;
  amount: number | null; // 인건비인데 payroll.view 없으면 null(숨김) — 그래도 행 자체·분류는 보인다.
  memo: string;
  createdById: string | null; // 실행취소(restoreEntry)가 원래 기록자를 그대로 되살리기 위해 넘긴다
  createdByName: string | null;
  editable: boolean; // 이 사람이 이 행을 수정·삭제할 수 있는지(분류별 권한 반영, 클라에서 다시 안 물어봐도 되게)
};

export type CategorySummaryRow = {
  direction: FinanceDirection;
  category: string; // FINANCE_CATEGORIES 의 key, 도시락 자동 항목만 예외로 "lunch_auto"
  label: string;
  amount: number | null; // 가려졌으면 null(금액도 비중도 안 보임 — 비중까지 보이면 총계 역산으로 금액이 새어나간다)
  share: number | null; // 0~1
  auto: boolean; // 도시락 자동 집계(수정·삭제 불가, 시각적으로 구분)
  hidden: boolean;
};

export type MonthData = {
  year: number; month: number;
  entries: LedgerRow[];
  lunchIncome: number; // 그 달 자동 도시락 수입(수정·삭제 불가)
  tuitionIncome: number; // 그 달 자동 학원비 수입(billing_payment.paid_amount 합계, 수정·삭제 불가)
  totalIncome: number; // lunchIncome+tuitionIncome 포함, 항상 실제 총액(숨김 여부와 무관)
  totalExpense: number; // 항상 실제 총액
  hasHiddenAmount: boolean; // 인건비가 있는데 이 사람에게 가려졌는지
  categorySummary: CategorySummaryRow[];
  trend: { year: number; month: number; income: number; expense: number; net: number }[];
};

export async function getMonthData(year: number, month: number): Promise<MonthData> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");
  const canSeePayroll = can(me, "payroll.view");
  const { start, nextStart } = monthRange(year, month);

  const [ledgerRes, lunchRes, tuitionRes, trendLedgerRes, trendLunchRes, trendTuitionRes] = await Promise.all([
    db.query<{
      id: string; date: string; direction: FinanceDirection; category: string; amount: number;
      memo: string | null; created_by_id: string | null; created_by_name: string | null;
    }>(
      `select l.id, l.date::text as date, l.direction, l.category, l.amount, l.memo,
              l.created_by as created_by_id, p.name as created_by_name
         from finance_ledger l
         left join person p on p.id = l.created_by
        where l.branch_id=$1 and l.date>=$2::date and l.date<$3::date
        order by l.date desc, l.created_at desc`,
      [branchId, start, nextStart],
    ),
    db.query<{ total: number }>(
      `select coalesce(sum(o.paid_amount),0)::int as total
         from lunch_order o
         join lunch_month lm on lm.id = o.month_id
        where o.branch_id=$1 and o.paid=true and lm.year=$2 and lm.month=$3`,
      [branchId, year, month],
    ),
    // 학원비 자동 수입 — billing_payment 는 결제일(paid_date) 기준으로 그 달에 귀속시킨다(도시락이
    // 신청 월 기준인 것과 같은 원리: "돈이 실제로 들어온 달"로 잡는다, 수강기간이 걸쳐 있어도 무관).
    db.query<{ total: number }>(
      `select coalesce(sum(paid_amount),0)::int as total
         from billing_payment
        where branch_id=$1 and paid_date>=$2::date and paid_date<$3::date`,
      [branchId, start, nextStart],
    ),
    // 추이(최근 12개월) — 지점+월 축으로 한 방에 집계(N+1 금지). 도시락·학원비는 아래 별도 쿼리.
    trendQuery(branchId, year, month),
    trendLunchQuery(branchId, year, month),
    trendTuitionQuery(branchId, year, month),
  ]);

  const lunchIncome = lunchRes.rows[0]?.total ?? 0;
  const tuitionIncome = tuitionRes.rows[0]?.total ?? 0;
  let manualIncome = 0, manualExpense = 0, hasHiddenAmount = false;
  const entries: LedgerRow[] = ledgerRes.rows.map((r) => {
    if (r.direction === "income") manualIncome += r.amount; else manualExpense += r.amount;
    const isPayroll = r.category === PAYROLL_CATEGORY;
    if (isPayroll && !canSeePayroll) hasHiddenAmount = true;
    return {
      id: r.id, date: r.date, direction: r.direction, category: r.category,
      amount: isPayroll && !canSeePayroll ? null : r.amount,
      memo: r.memo ?? "", createdById: r.created_by_id, createdByName: r.created_by_name,
      editable: canManageCategory(me, r.direction, r.category),
    };
  });

  // 분류별 내역 — FINANCE_CATEGORIES 순서 그대로, manualIncome/manualExpense 계산과 같은 entries 를
  // 다시 훑어 합산한다(별도 SQL 없이 이미 가져온 행으로 충분 — 한 달 장부는 N+1 걱정할 규모가 아니다).
  const sums = new Map<string, number>(); // `${direction}:${category}` -> amount(가려짐과 무관하게 실제값)
  for (const r of ledgerRes.rows) {
    const key = `${r.direction}:${r.category}`;
    sums.set(key, (sums.get(key) ?? 0) + r.amount);
  }
  const totalIncome = manualIncome + lunchIncome + tuitionIncome;
  const totalExpense = manualExpense;
  const categorySummary: CategorySummaryRow[] = [];
  for (const def of FINANCE_CATEGORIES) {
    const amt = sums.get(`${def.direction}:${def.key}`) ?? 0;
    if (amt === 0) continue; // 0원 분류는 목록을 어지럽히니 생략
    const isPayroll = def.key === PAYROLL_CATEGORY;
    const total = def.direction === "income" ? totalIncome : totalExpense;
    const hidden = isPayroll && !canSeePayroll;
    categorySummary.push({
      direction: def.direction, category: def.key, label: def.label, auto: false, hidden,
      amount: hidden ? null : amt,
      share: hidden || total <= 0 ? (hidden ? null : 0) : amt / total,
    });
  }
  // 학원비 폐지 전에 손으로 적어둔 tuition 행 — FINANCE_CATEGORIES 에서 빠졌으니 위 루프가 건너뛰지만,
  // 실제 금액은 totalIncome 에 이미 포함돼 있다(entries 전체를 합산한 manualIncome 이 근원). 분류별
  // 내역에서 이 금액이 그냥 사라지면 "분류 합계 ≠ 총 수입" 으로 보여 혼란스러우니 과거 기록임을
  // 밝힌 별도 줄로 항상 보여준다(src/lib/finance.ts 주석 참고).
  const legacyTuition = sums.get("income:tuition") ?? 0;
  if (legacyTuition > 0) {
    categorySummary.push({
      direction: "income", category: "tuition", label: "학원비(과거 수기입력)", auto: false, hidden: false,
      amount: legacyTuition, share: totalIncome > 0 ? legacyTuition / totalIncome : 0,
    });
  }
  // 학원비 자동 수입(결제 모듈) — 도시락과 같은 방식으로, 손입력 목록과 다른 줄로 맨 위에 얹는다.
  categorySummary.unshift({
    direction: "income", category: "tuition_auto", label: "학원비(자동)", auto: true, hidden: false,
    amount: tuitionIncome, share: totalIncome > 0 ? tuitionIncome / totalIncome : 0,
  });
  // 도시락 자동 수입 — 손입력 목록과 다른 줄로, 맨 위(수입 분류 중 첫머리)에 얹는다.
  categorySummary.unshift({
    direction: "income", category: "lunch_auto", label: "도시락(자동)", auto: true, hidden: false,
    amount: lunchIncome, share: totalIncome > 0 ? lunchIncome / totalIncome : 0,
  });

  const months = trailingMonths(year, month, 12);
  const ledgerByKey = new Map(trendLedgerRes.map((r) => [`${r.year}-${r.month}-${r.direction}`, r.amt]));
  const lunchByKey = new Map(trendLunchRes.map((r) => [`${r.year}-${r.month}`, r.amt]));
  const tuitionByKey = new Map(trendTuitionRes.map((r) => [`${r.year}-${r.month}`, r.amt]));
  const trend = months.map(({ year: y, month: m }) => {
    const income = (ledgerByKey.get(`${y}-${m}-income`) ?? 0) + (lunchByKey.get(`${y}-${m}`) ?? 0) + (tuitionByKey.get(`${y}-${m}`) ?? 0);
    const expense = ledgerByKey.get(`${y}-${m}-expense`) ?? 0;
    return { year: y, month: m, income, expense, net: income - expense };
  });

  return {
    year, month, entries,
    lunchIncome,
    tuitionIncome,
    totalIncome,
    totalExpense,
    hasHiddenAmount,
    categorySummary,
    trend,
  };
}

async function trendQuery(branchId: string, year: number, month: number) {
  const first = trailingMonths(year, month, 12)[0];
  const { start } = monthRange(first.year, first.month);
  const { nextStart } = monthRange(year, month);
  const r = await db.query<{ ym: string; direction: FinanceDirection; amt: number }>(
    `select to_char(date_trunc('month', date), 'YYYY-MM') as ym, direction, sum(amount)::int as amt
       from finance_ledger
      where branch_id=$1 and date>=$2::date and date<$3::date
      group by 1, 2`,
    [branchId, start, nextStart],
  );
  return r.rows.map((row) => {
    const [y, m] = row.ym.split("-").map(Number);
    return { year: y, month: m, direction: row.direction, amt: row.amt };
  });
}

async function trendLunchQuery(branchId: string, year: number, month: number) {
  const first = trailingMonths(year, month, 12)[0];
  const { start } = monthRange(first.year, first.month);
  const { nextStart } = monthRange(year, month);
  const r = await db.query<{ year: number; month: number; amt: number }>(
    `select lm.year, lm.month, coalesce(sum(o.paid_amount),0)::int as amt
       from lunch_month lm
       left join lunch_order o on o.month_id = lm.id and o.paid = true
      where lm.branch_id=$1 and make_date(lm.year, lm.month, 1) >= $2::date
        and make_date(lm.year, lm.month, 1) < $3::date
      group by lm.year, lm.month`,
    [branchId, start, nextStart],
  );
  return r.rows;
}

async function trendTuitionQuery(branchId: string, year: number, month: number) {
  const first = trailingMonths(year, month, 12)[0];
  const { start } = monthRange(first.year, first.month);
  const { nextStart } = monthRange(year, month);
  const r = await db.query<{ year: number; month: number; amt: number }>(
    `select extract(year from paid_date)::int as year, extract(month from paid_date)::int as month,
            coalesce(sum(paid_amount),0)::int as amt
       from billing_payment
      where branch_id=$1 and paid_date>=$2::date and paid_date<$3::date
      group by 1, 2`,
    [branchId, start, nextStart],
  );
  return r.rows;
}

// ---------------- 추가 ----------------
export async function addEntry(formData: FormData): Promise<FinanceResult> {
  const me = await requireView(); // 분류별 세부 권한은 아래에서 다시 확인
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };

  const date = s(formData.get("date"));
  const direction = s(formData.get("direction"));
  const category = s(formData.get("category"));
  const amountRaw = s(formData.get("amount"));
  const memo = s(formData.get("memo")) ?? "";

  if (!date || !DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
  if (direction !== "income" && direction !== "expense") return { ok: false, error: "수입/지출을 선택하세요." };
  if (!category || !isValidCategory(direction, category)) return { ok: false, error: "분류를 선택하세요." };
  const amount = amountRaw ? parseInt(amountRaw, 10) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "금액을 입력하세요." };
  if (!canManageCategory(me, direction, category)) return { ok: false, error: "이 분류를 기록할 권한이 없습니다." };

  await db.query(
    `insert into finance_ledger(branch_id, date, direction, category, amount, memo, created_by)
     values ($1::uuid,$2::date,$3,$4,$5,$6,$7::uuid)`,
    [branchId, date, direction, category, amount, memo, me.id],
  );
  revalidatePath("/m/finance");
  return { ok: true };
}

// ---------------- 수정 ----------------
export async function updateEntry(formData: FormData): Promise<FinanceResult> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = s(formData.get("id"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };

  const existing = await db.query<{ direction: FinanceDirection; category: string }>(
    `select direction, category from finance_ledger where id=$1::uuid and branch_id=$2::uuid`,
    [id, branchId],
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, error: "대상을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)." };
  if (!canManageCategory(me, row.direction, row.category)) return { ok: false, error: "권한이 없습니다." };

  const date = s(formData.get("date"));
  const category = s(formData.get("category"));
  const amountRaw = s(formData.get("amount"));
  const memo = s(formData.get("memo")) ?? "";
  if (!date || !DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
  if (!category || !isValidCategory(row.direction, category)) return { ok: false, error: "분류를 선택하세요." };
  const amount = amountRaw ? parseInt(amountRaw, 10) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "금액을 입력하세요." };
  // 방향을 바꾸는 건 지금은 지원 안 함(수입 항목을 지출로 바꾸는 건 사실상 새 항목) — 분류·금액·메모·
  // 날짜만 수정. 분류가 바뀌어 payroll ↔ 일반으로 넘어가는 경우 위 canManageCategory 를 새 분류로도
  // 다시 확인해야 하므로 여기서 한 번 더 검사한다.
  if (!canManageCategory(me, row.direction, category)) return { ok: false, error: "이 분류로 바꿀 권한이 없습니다." };

  await db.query(
    `update finance_ledger set date=$3::date, category=$4, amount=$5, memo=$6, updated_at=now()
      where id=$1::uuid and branch_id=$2::uuid`,
    [id, branchId, date, category, amount, memo],
  );
  revalidatePath("/m/finance");
  return { ok: true };
}

// ---------------- 삭제(실행취소용 — 하드 삭제, 클라가 들고 있던 값으로 재삽입해 되돌린다) ----------------
export async function deleteEntry(formData: FormData): Promise<FinanceResult> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = s(formData.get("id"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };

  const existing = await db.query<{ direction: FinanceDirection; category: string }>(
    `select direction, category from finance_ledger where id=$1::uuid and branch_id=$2::uuid`,
    [id, branchId],
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, error: "대상을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)." };
  if (!canManageCategory(me, row.direction, row.category)) return { ok: false, error: "권한이 없습니다." };

  await db.query(`delete from finance_ledger where id=$1::uuid and branch_id=$2::uuid`, [id, branchId]);
  revalidatePath("/m/finance");
  return { ok: true };
}

/** 삭제 실행취소 — 같은 id 로 재삽입(정정 이력이 튀지 않게). 클라가 삭제 직전 값을 그대로 들고 있다가
 *  넘긴다(penalty/patrol 모듈과 같은 패턴 — 서버에 별도 휴지통 없이 클라 상태가 스냅샷). */
export async function restoreEntry(formData: FormData): Promise<FinanceResult> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };

  const id = s(formData.get("id"));
  const date = s(formData.get("date"));
  const direction = s(formData.get("direction"));
  const category = s(formData.get("category"));
  const amountRaw = s(formData.get("amount"));
  const memo = s(formData.get("memo")) ?? "";
  const createdBy = s(formData.get("createdBy"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "복원할 수 없습니다." };
  if (!date || !DATE_RE.test(date)) return { ok: false, error: "복원할 수 없습니다." };
  if (direction !== "income" && direction !== "expense") return { ok: false, error: "복원할 수 없습니다." };
  if (!category || !isValidCategory(direction, category)) return { ok: false, error: "복원할 수 없습니다." };
  const amount = amountRaw ? parseInt(amountRaw, 10) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "복원할 수 없습니다." };
  if (!canManageCategory(me, direction, category)) return { ok: false, error: "권한이 없습니다." };

  await db.query(
    `insert into finance_ledger(id, branch_id, date, direction, category, amount, memo, created_by)
     values ($1::uuid,$2::uuid,$3::date,$4,$5,$6,$7,$8::uuid)
     on conflict (id) do nothing`,
    [id, branchId, date, direction, category, amount, memo, createdBy && UUID_RE.test(createdBy) ? createdBy : null],
  );
  revalidatePath("/m/finance");
  return { ok: true };
}

