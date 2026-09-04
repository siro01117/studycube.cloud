"use server";

// 학원비 결제(상품 + 결제 + 수강기간) 서버 액션. 조회는 billing.view, 상품·결제 등록/삭제는
// billing.manage — 상품 가격 관리를 더 좁은 권한으로 가를지 검토했으나, 가격을 바꿔도 이미 끝난
// 결제는 스냅샷(list_price)이라 안 흔들리므로 위험이 "다음 결제부터 잘못된 가격이 보임" 정도로
// 낮다. 이미 결제 자체를 billing.manage 로 통제하고 있어(결제창에서 실납을 직접 입력하므로 가격
// 표시가 틀려도 실제 수납액은 담당자가 다시 확인·입력한다), 별도 권한 축을 새로 파는 대신 기존
// billing.manage 하나로 묶었다 — 권한 축이 늘어날수록 역할 배정을 잊어 잠기는 사고가 늘어난다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { can, guard, type Me } from "@/lib/auth";
import { todayKey } from "@/lib/date";
import { computePeriod, daysUntil } from "@/lib/tuition";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ["card", "transfer", "cash"] as const;
export type BillingMethod = (typeof METHODS)[number];
const isMethod = (v: string | null): v is BillingMethod => !!v && (METHODS as readonly string[]).includes(v);

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

export type BillingResult = { ok: true } | { ok: false; error: string };

async function requireView(): Promise<Me> {
  return guard("billing.view");
}
async function requireManage(): Promise<Me> {
  return guard("billing.manage");
}

// ---------------- 상품 ----------------
export type ProductRow = {
  id: string; name: string; price: number; durationDays: number;
  active: boolean; ord: number; memo: string;
};

export async function getProducts(): Promise<ProductRow[]> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return [];
  const r = await db.query<{
    id: string; name: string; price: number; duration_days: number; active: boolean; ord: number; memo: string | null;
  }>(
    `select id, name, price, duration_days, active, ord, memo
       from billing_product where branch_id=$1::uuid
      order by active desc, ord, name`,
    [branchId],
  );
  return r.rows.map((x) => ({
    id: x.id, name: x.name, price: x.price, durationDays: x.duration_days,
    active: x.active, ord: x.ord, memo: x.memo ?? "",
  }));
}

export async function saveProduct(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };

  const id = s(formData.get("id"));
  const name = s(formData.get("name"));
  const priceRaw = s(formData.get("price"));
  const durationRaw = s(formData.get("durationDays"));
  const memo = s(formData.get("memo")) ?? "";
  if (!name) return { ok: false, error: "상품명을 입력하세요." };
  const price = priceRaw ? parseInt(priceRaw, 10) : NaN;
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: "가격을 입력하세요." };
  const duration = durationRaw ? parseInt(durationRaw, 10) : 30;
  if (!Number.isFinite(duration) || duration <= 0) return { ok: false, error: "기간(일)을 입력하세요." };

  if (id && UUID_RE.test(id)) {
    await db.query(
      `update billing_product set name=$3, price=$4, duration_days=$5, memo=$6
        where id=$1::uuid and branch_id=$2::uuid`,
      [id, branchId, name, price, duration, memo],
    );
  } else {
    const ordR = await db.query<{ next: number }>(
      `select coalesce(max(ord), 0) + 1 as next from billing_product where branch_id=$1::uuid`,
      [branchId],
    );
    await db.query(
      `insert into billing_product(branch_id, name, price, duration_days, memo, ord, created_by)
       values ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)`,
      [branchId, name, price, duration, memo, ordR.rows[0]?.next ?? 0, me.id],
    );
  }
  revalidatePath("/m/finance/billing");
  return { ok: true };
}

/** 판매중/판매중지 토글 — 상품을 지우지 않는다(과거 결제가 product_id 를 참조하고, product_name/
 *  list_price 는 이미 스냅샷이라 상품이 사라져도 무방하지만, 그래도 참조 무결성과 재사용(다음 학기에
 *  다시 켬)을 위해 삭제 대신 active 플래그로만 다룬다). */
export async function setProductActive(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = s(formData.get("id"));
  const active = s(formData.get("active")) === "true";
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  await db.query(`update billing_product set active=$3 where id=$1::uuid and branch_id=$2::uuid`, [id, branchId, active]);
  revalidatePath("/m/finance/billing");
  return { ok: true };
}

// ---------------- 학생 목록(결제 화면용) + 메모 ----------------
export type StudentOption = { id: string; name: string; grade: string | null; school: string | null; memo: string };

export async function getStudentsForBilling(): Promise<StudentOption[]> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return [];
  const r = await db.query<{ id: string; name: string; grade: string | null; school: string | null; memo: string | null }>(
    `select id, name, grade, school, memo from student where branch_id=$1::uuid and status='enrolled' order by name`,
    [branchId],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, grade: x.grade, school: x.school, memo: x.memo ?? "" }));
}

/** 학생 메모 — 학생 관리 화면(다른 작업이 편집 중)과 별개로 결제 화면에서 바로 고칠 수 있게 한다
 *  (예외 할인 확인용, 집주인 지시). billing.manage 로 gate — 결제 담당자만 고칠 수 있다. */
export async function updateStudentMemo(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const studentId = s(formData.get("studentId"));
  const memo = s(formData.get("memo")) ?? "";
  if (!studentId || !UUID_RE.test(studentId)) return { ok: false, error: "학생을 찾을 수 없습니다." };
  await db.query(`update student set memo=$3 where id=$1::uuid and branch_id=$2::uuid`, [studentId, branchId, memo]);
  revalidatePath("/m/finance/billing");
  return { ok: true };
}

// ---------------- 결제 등록 ----------------
export type PeriodPreview = { start: string; end: string; previousPeriodEnd: string | null };

/** 결제 등록 화면이 "언제부터 언제까지"를 저장 전에 미리 보여줄 때 쓴다 — 실제 저장(addPayment)도
 *  같은 src/lib/tuition.ts computePeriod() 를 쓰므로 미리보기와 저장값이 절대 어긋나지 않는다. */
export async function previewPeriod(studentId: string, durationDays: number, paidDate: string): Promise<PeriodPreview | null> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId || !UUID_RE.test(studentId) || !DATE_RE.test(paidDate) || !Number.isFinite(durationDays) || durationDays <= 0) return null;
  const prevR = await db.query<{ prev_end: string | null }>(
    `select max(period_end)::text as prev_end from billing_payment where branch_id=$1::uuid and student_id=$2::uuid`,
    [branchId, studentId],
  );
  const previousPeriodEnd = prevR.rows[0]?.prev_end ?? null;
  const period = computePeriod(paidDate, durationDays, previousPeriodEnd);
  return { start: period.start, end: period.end, previousPeriodEnd };
}

export async function addPayment(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };

  const studentId = s(formData.get("studentId"));
  const productId = s(formData.get("productId"));
  const paidAmountRaw = s(formData.get("paidAmount"));
  const method = s(formData.get("method"));
  const paidDate = s(formData.get("paidDate"));
  const discountReason = s(formData.get("discountReason")) ?? "";
  const memo = s(formData.get("memo")) ?? "";
  const externalRef = s(formData.get("externalRef")) ?? "";

  if (!studentId || !UUID_RE.test(studentId)) return { ok: false, error: "학생을 선택하세요." };
  if (!productId || !UUID_RE.test(productId)) return { ok: false, error: "상품을 선택하세요." };
  if (!paidDate || !DATE_RE.test(paidDate)) return { ok: false, error: "결제일이 올바르지 않습니다." };
  if (!isMethod(method)) return { ok: false, error: "결제수단을 선택하세요." };
  const paidAmount = paidAmountRaw ? parseInt(paidAmountRaw, 10) : NaN;
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return { ok: false, error: "실 결제 금액을 입력하세요." };

  const [prodR, stuR] = await Promise.all([
    db.query<{ name: string; price: number; duration_days: number }>(
      `select name, price, duration_days from billing_product where id=$1::uuid and branch_id=$2::uuid`,
      [productId, branchId],
    ),
    db.query(`select 1 from student where id=$1::uuid and branch_id=$2::uuid`, [studentId, branchId]),
  ]);
  const product = prodR.rows[0];
  if (!product) return { ok: false, error: "상품을 찾을 수 없습니다." };
  if (!stuR.rows[0]) return { ok: false, error: "학생을 찾을 수 없습니다." };

  const prevR = await db.query<{ prev_end: string | null }>(
    `select max(period_end)::text as prev_end from billing_payment where branch_id=$1::uuid and student_id=$2::uuid`,
    [branchId, studentId],
  );
  const period = computePeriod(paidDate, product.duration_days, prevR.rows[0]?.prev_end ?? null);

  await db.query(
    `insert into billing_payment(
       branch_id, student_id, product_id, product_name, list_price, paid_amount,
       discount_reason, method, paid_date, period_start, period_end, memo, external_ref, created_by
     ) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::date,$10::date,$11::date,$12,$13,$14::uuid)`,
    [
      branchId, studentId, productId, product.name, product.price, paidAmount,
      discountReason || null, method, paidDate, period.start, period.end, memo, externalRef || null, me.id,
    ],
  );
  revalidatePath("/m/finance/billing");
  revalidatePath("/m/finance");
  return { ok: true };
}

/** 하드 삭제 + 클라 실행취소(저장소 관례, UndoToast.tsx) — 다른 결제의 기간은 재계산하지 않는다
 *  (근거는 src/lib/tuition.ts 주석). 수정(update) 액션은 의도적으로 안 만든다 — 실 결제 기록을
 *  조용히 고치는 경로를 열어두는 대신, 잘못 등록했으면 지우고 다시 등록하게 한다(그러면 새 행의
 *  created_at/created_by 로 "누가 언제 다시 등록했는지"가 자연히 남는다 — 별도 수정이력 테이블 없이
 *  §9 요구를 충분히 만족). */
export async function deletePayment(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = s(formData.get("id"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  await db.query(`delete from billing_payment where id=$1::uuid and branch_id=$2::uuid`, [id, branchId]);
  revalidatePath("/m/finance/billing");
  revalidatePath("/m/finance");
  return { ok: true };
}

export async function restorePayment(formData: FormData): Promise<BillingResult> {
  const me = await requireManage();
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const get = (k: string) => s(formData.get(k));
  const id = get("id"), studentId = get("studentId"), productId = get("productId"), productName = get("productName");
  const listPriceRaw = get("listPrice"), paidAmountRaw = get("paidAmount"), method = get("method"), paidDate = get("paidDate");
  const periodStart = get("periodStart"), periodEnd = get("periodEnd");
  const discountReason = get("discountReason") ?? "", memo = get("memo") ?? "", externalRef = get("externalRef") ?? "";
  const createdBy = get("createdBy");
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "복원할 수 없습니다." };
  if (!studentId || !UUID_RE.test(studentId)) return { ok: false, error: "복원할 수 없습니다." };
  if (!paidDate || !DATE_RE.test(paidDate) || !periodStart || !DATE_RE.test(periodStart) || !periodEnd || !DATE_RE.test(periodEnd)) {
    return { ok: false, error: "복원할 수 없습니다." };
  }
  const listPrice = parseInt(listPriceRaw ?? "", 10), paidAmount = parseInt(paidAmountRaw ?? "", 10);
  if (!Number.isFinite(listPrice) || !Number.isFinite(paidAmount)) return { ok: false, error: "복원할 수 없습니다." };
  if (!isMethod(method)) return { ok: false, error: "복원할 수 없습니다." };

  await db.query(
    `insert into billing_payment(
       id, branch_id, student_id, product_id, product_name, list_price, paid_amount,
       discount_reason, method, paid_date, period_start, period_end, memo, external_ref, created_by
     ) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::date,$11::date,$12::date,$13,$14,$15::uuid)
     on conflict (id) do nothing`,
    [
      id, branchId, studentId, productId && UUID_RE.test(productId) ? productId : null, productName ?? "",
      listPrice, paidAmount, discountReason || null, method, paidDate, periodStart, periodEnd, memo,
      externalRef || null, createdBy && UUID_RE.test(createdBy) ? createdBy : null,
    ],
  );
  revalidatePath("/m/finance/billing");
  revalidatePath("/m/finance");
  return { ok: true };
}

// ---------------- 결제 내역(학생별·기간별) ----------------
export type PaymentRow = {
  id: string; studentId: string; studentName: string; productId: string | null; productName: string;
  listPrice: number; paidAmount: number; method: BillingMethod; paidDate: string;
  periodStart: string; periodEnd: string; discountReason: string; memo: string; externalRef: string;
  createdByName: string | null; createdById: string | null; editable: boolean;
};

export async function getPayments(filter: { studentId?: string; from?: string; to?: string }): Promise<PaymentRow[]> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return [];
  const canManage = can(me, "billing.manage");
  const conds: string[] = ["bp.branch_id = $1::uuid"];
  const params: unknown[] = [branchId];
  if (filter.studentId && UUID_RE.test(filter.studentId)) {
    params.push(filter.studentId);
    conds.push(`bp.student_id = $${params.length}::uuid`);
  }
  if (filter.from && DATE_RE.test(filter.from)) {
    params.push(filter.from);
    conds.push(`bp.paid_date >= $${params.length}::date`);
  }
  if (filter.to && DATE_RE.test(filter.to)) {
    params.push(filter.to);
    conds.push(`bp.paid_date <= $${params.length}::date`);
  }
  const r = await db.query<{
    id: string; student_id: string; student_name: string; product_id: string | null; product_name: string;
    list_price: number; paid_amount: number; method: BillingMethod; paid_date: string;
    period_start: string; period_end: string; discount_reason: string | null; memo: string | null;
    external_ref: string | null; created_by_id: string | null; created_by_name: string | null;
  }>(
    `select bp.id, bp.student_id, s.name as student_name, bp.product_id, bp.product_name,
            bp.list_price, bp.paid_amount, bp.method, bp.paid_date::text as paid_date,
            bp.period_start::text as period_start, bp.period_end::text as period_end,
            bp.discount_reason, bp.memo, bp.external_ref,
            bp.created_by as created_by_id, p.name as created_by_name
       from billing_payment bp
       join student s on s.id = bp.student_id
       left join person p on p.id = bp.created_by
      where ${conds.join(" and ")}
      order by bp.paid_date desc, bp.created_at desc`,
    params,
  );
  return r.rows.map((x) => ({
    id: x.id, studentId: x.student_id, studentName: x.student_name, productId: x.product_id, productName: x.product_name,
    listPrice: x.list_price, paidAmount: x.paid_amount, method: x.method, paidDate: x.paid_date,
    periodStart: x.period_start, periodEnd: x.period_end,
    discountReason: x.discount_reason ?? "", memo: x.memo ?? "", externalRef: x.external_ref ?? "",
    createdById: x.created_by_id, createdByName: x.created_by_name, editable: canManage,
  }));
}

// ---------------- 수강기간 만료 관리 ----------------
const EXPIRING_WITHIN_DAYS = 7; // sms-auto.ts 가 같은 값을 별도로 복사해 쓴다("use server" 파일은 async 함수 외의
// export 가 안 돼(Next 제약) 여기서 바로 내보낼 수 없다 — sms-worker.mjs 가 SMS_MAX_ATTEMPTS 를
// 복사해 쓰는 것과 같은 관례, sms.ts 상단 주석). 바뀌면 두 곳 다 고칠 것.

export type BillingStatus = "active" | "expiring_soon" | "expired" | "never_paid";
export type StudentBillingOverview = {
  studentId: string; studentName: string; studentMemo: string;
  periodEnd: string | null; daysLeft: number | null; status: BillingStatus;
};

/** 재원생 전원의 현재 수강 만료 현황 — 학생마다 쿼리하지 않고 LATERAL 조인 한 번으로 "학생별 가장
 *  늦은 결제 종료일"을 가져온다(90명이어도 쿼리 1회, idx_billing_payment_branch_student 사용).
 *  결제 등록/결제내역 화면의 "학생 목록에 지금 상태를 같이 보여주기"용 — getExpiringStudents 는
 *  이 목록을 만료 임박·만료로만 걸러 재사용한다. */
export async function getStudentBillingOverview(): Promise<StudentBillingOverview[]> {
  const me = await requireView();
  const branchId = me.activeBranchId;
  if (!branchId) return [];
  const today = todayKey();
  const r = await db.query<{ student_id: string; student_name: string; memo: string | null; period_end: string | null }>(
    `select s.id as student_id, s.name as student_name, s.memo, bp.period_end::text as period_end
       from student s
       left join lateral (
         select bp2.period_end from billing_payment bp2
          where bp2.branch_id = s.branch_id and bp2.student_id = s.id
          order by bp2.period_end desc limit 1
       ) bp on true
      where s.branch_id = $1::uuid and s.status = 'enrolled'
      order by s.name`,
    [branchId],
  );
  return r.rows.map((row): StudentBillingOverview => {
    if (!row.period_end) {
      return { studentId: row.student_id, studentName: row.student_name, studentMemo: row.memo ?? "", periodEnd: null, daysLeft: null, status: "never_paid" };
    }
    const left = daysUntil(row.period_end, today);
    const status: BillingStatus = left < 0 ? "expired" : left <= EXPIRING_WITHIN_DAYS ? "expiring_soon" : "active";
    return { studentId: row.student_id, studentName: row.student_name, studentMemo: row.memo ?? "", periodEnd: row.period_end, daysLeft: left, status };
  });
}

export type ExpiringStudent = {
  studentId: string; studentName: string; periodEnd: string; daysLeft: number; status: "expiring_soon" | "expired";
};

/** 홈(대시보드) "오늘 남은 일" 이 부를 함수 — 만료 임박(오늘부터 7일 이내)·이미 만료된 재원생만
 *  daysLeft 오름차순(가장 급한 것부터)으로 돌려준다. 반환 형태: ExpiringStudent[] (이 파일에서 export).
 *  주의: billing.view 가드가 걸려 있다 — 홈은 이걸 부르기 전에 can(me,"billing.view") 로 감싸야
 *  권한 없는 사람 화면에서 예외로 통째로 죽지 않는다(현재 이 권한은 CTO 전용, ADMIN_PERM_KEYS 에서
 *  의도적으로 빠져 있음 — bootstrap.ts 참고). */
export async function getExpiringStudents(): Promise<ExpiringStudent[]> {
  const all = await getStudentBillingOverview();
  const out: ExpiringStudent[] = [];
  for (const x of all) {
    if (x.status !== "expiring_soon" && x.status !== "expired") continue;
    out.push({ studentId: x.studentId, studentName: x.studentName, periodEnd: x.periodEnd as string, daysLeft: x.daysLeft as number, status: x.status });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}
