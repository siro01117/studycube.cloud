"use server";

// 도시락 관리 화면(_demo/**, 원본 도시락앱 렌더러 verbatim 이식)이 부르던 window.api 함수들의
// 서버 액션 버전. _demo/api.ts(옛 localStorage 어댑터)가 이 파일을 호출하도록 바뀌었다 —
// 화면 코드(App.tsx, pages/*, components/*)는 이 파일의 존재를 모른다(window.api만 호출).
//
// 학생 신청 폼(f/[slug]/forms/lunch-actions.ts)과 같은 테이블(lunch_month/lunch_closure/
// lunch_order/lunch_meal)을 쓴다 — 휴무·마감 판정은 반드시 src/lib/lunch.ts 의 순수 함수를
// 그대로 써서 양쪽이 어긋나지 않게 한다(재발명 금지).
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { getOrCreateMonth, listClosures as listClosuresDb } from "@/lib/lunch-server";
import { todayKey } from "@/lib/date";
import { asJson } from "@/lib/jsonb";
import type { LunchMonth, Closure, MealType } from "@/lib/lunch";

async function branchOf(): Promise<string> {
  await ready();
  const me = await guard("lunch.view");
  if (!me.activeBranchId) throw new Error("소속 지점을 확인할 수 없습니다");
  return me.activeBranchId;
}
async function branchOfManage(): Promise<string> {
  await ready();
  const me = await guard("lunch.manage");
  if (!me.activeBranchId) throw new Error("소속 지점을 확인할 수 없습니다");
  return me.activeBranchId;
}

/** monthId 가 이 지점 소유인지 확인(다른 지점 데이터 유출 방지). 통과 시 월 행 반환. */
async function assertMonth(monthId: string, branchId: string): Promise<LunchMonth> {
  const r = await db.query<LunchMonth>(
    `select id, year, month, lunch_label, lunch_price, dinner_label, dinner_price, notice
       from lunch_month where id=$1 and branch_id=$2`,
    [monthId, branchId],
  );
  if (!r.rows[0]) throw new Error("잘못된 요청입니다");
  return r.rows[0];
}

// ---------------- 1. getMonth ----------------
export async function getMonth(year: number, month: number): Promise<LunchMonth> {
  const branchId = await branchOf();
  return getOrCreateMonth(branchId, year, month);
}

// ---------------- 2. updateMonth ----------------
export type MonthFields = Partial<{
  lunch_label: string; lunch_price: number; dinner_label: string; dinner_price: number; notice: string;
}>;
export async function updateMonth(monthId: string, fields: MonthFields): Promise<void> {
  const branchId = await branchOfManage();
  await assertMonth(monthId, branchId);

  const params: unknown[] = [monthId, branchId];
  const sets: string[] = [];
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col}=$${params.length}`); };
  if (fields.lunch_label !== undefined) add("lunch_label", fields.lunch_label);
  if (fields.lunch_price !== undefined) add("lunch_price", fields.lunch_price);
  if (fields.dinner_label !== undefined) add("dinner_label", fields.dinner_label);
  if (fields.dinner_price !== undefined) add("dinner_price", fields.dinner_price);
  if (fields.notice !== undefined) add("notice", fields.notice);
  if (!sets.length) return;

  await db.query(`update lunch_month set ${sets.join(", ")} where id=$1 and branch_id=$2`, params);
}

// ---------------- 3. listClosures ----------------
export async function listClosures(monthId: string): Promise<Closure[]> {
  const branchId = await branchOf();
  await assertMonth(monthId, branchId);
  return listClosuresDb(monthId);
}

// ---------------- 4. setClosure ----------------
export async function setClosure(
  monthId: string, date: string, lunchClosed: boolean, dinnerClosed: boolean, label: string,
): Promise<void> {
  const branchId = await branchOfManage();
  await assertMonth(monthId, branchId);
  await db.query(
    `insert into lunch_closure(month_id, date, lunch_closed, dinner_closed, label)
     values ($1,$2,$3,$4,$5)
     on conflict (month_id, date) do update set lunch_closed=$3, dinner_closed=$4, label=$5`,
    [monthId, date, lunchClosed, dinnerClosed, label || null],
  );
}

// ---------------- 신청서 공용 조회(N+1 금지 — join 한 방) ----------------
export type AppRow = {
  id: string; month_id: string; studentId: string;
  name: string; seat: string | null; floor: number | null;
  paid: boolean; paid_amount: number; paid_date: string | null; memo: string;
  source: "student" | "staff";
  meals: { date: string; meal_type: MealType }[];
};

const APP_SELECT = `
  select o.id, o.month_id, o.student_id as "studentId",
         s.name, seat.label as seat, room.floor as floor,
         o.paid, o.paid_amount, o.paid_date::text as paid_date, coalesce(o.memo, '') as memo,
         o.source,
         coalesce(
           json_agg(json_build_object('date', lm.date::text, 'meal_type', lm.meal_type) order by lm.date)
           filter (where lm.date is not null),
           '[]'
         ) as meals
    from lunch_order o
    join student s on s.id = o.student_id
    left join seat on seat.current_student_id = s.id and seat.branch_id = o.branch_id
    left join room on room.id = seat.room_id
`;

function rowToApp(r: Record<string, unknown>): AppRow {
  return {
    id: r.id as string,
    month_id: r.month_id as string,
    studentId: r.studentId as string,
    name: r.name as string,
    seat: (r.seat as string | null) ?? null,
    floor: (r.floor as number | null) ?? null,
    source: (r.source as "student" | "staff") ?? "staff",
    paid: !!r.paid,
    paid_amount: (r.paid_amount as number) ?? 0,
    paid_date: (r.paid_date as string | null) ?? null,
    memo: (r.memo as string) ?? "",
    meals: (asJson(r.meals) as { date: string; meal_type: MealType }[]) ?? [],
  };
}

// ---------------- 6. listApps ----------------
export async function listApps(monthId: string): Promise<AppRow[]> {
  const branchId = await branchOf();
  await assertMonth(monthId, branchId);
  const r = await db.query<Record<string, unknown>>(
    `${APP_SELECT}
     left join lunch_meal lm on lm.order_id = o.id
    where o.month_id=$1 and o.branch_id=$2
    group by o.id, s.name, seat.label, room.floor
    order by room.floor nulls last, s.name`,
    [monthId, branchId],
  );
  return r.rows.map(rowToApp);
}

// ---------------- 8. createApp (신규 등록 전용) ----------------
// 결제 정보만 고치는 경로는 updatePayment(아래)로 분리됐다 — 이 함수는 새 신청서를 만들 때만
// 부른다(ApplicationDialog.tsx: 학생 검색 → 신규 등록). 이미 신청서가 있는 학생은 검색 결과에서
// 걸러지므로 정상 경로로는 기존 행을 다시 여기로 보낼 일이 없다. 그래도 우회 호출에 대비해
// 아래 "끼니 변경 금지" 가드는 남겨둔다 — 클라만 막으면 뚫린다, 서버가 진짜 관문이다.
export type CreateAppPayload = {
  monthId: string; studentId: string;
  paidAmount: number; paidDate: string | null; memo: string;
  meals: { date: string; meal_type: MealType }[];
};
export async function createApp(payload: CreateAppPayload): Promise<string> {
  const branchId = await branchOfManage();
  const month = await assertMonth(payload.monthId, branchId);

  const st = await db.query<{ id: string }>(
    `select id from student where id=$1 and branch_id=$2`,
    [payload.studentId, branchId],
  );
  if (!st.rows[0]) throw new Error("학생을 찾을 수 없습니다");

  const ymPrefix = `${month.year}-${String(month.month).padStart(2, "0")}`;
  const meals = payload.meals.filter((m) => m.date.startsWith(ymPrefix) && (m.meal_type === "lunch" || m.meal_type === "dinner"));
  const lunchCnt = meals.filter((m) => m.meal_type === "lunch").length;
  const dinnerCnt = meals.filter((m) => m.meal_type === "dinner").length;
  const total = lunchCnt * month.lunch_price + dinnerCnt * month.dinner_price;
  const paidAmount = Math.max(0, payload.paidAmount || 0);
  const paid = paidAmount >= total && total > 0;

  // 신청서 수정 기능은 없앴다 — 이미 등록된 신청(학생 제출/카운터 등록 무관)의 끼니는 그 무엇으로도
  // 못 고친다(결제만 고치고 싶으면 updatePayment 를 써야 한다).
  const existing = await db.query<{ id: string; date: string; meal_type: MealType }>(
    `select o.id, lm.date::text as date, lm.meal_type
       from lunch_order o
       left join lunch_meal lm on lm.order_id = o.id
      where o.month_id=$1 and o.student_id=$2 and o.branch_id=$3`,
    [payload.monthId, payload.studentId, branchId],
  );
  if (existing.rows.length) {
    const existingKeys = new Set(
      existing.rows.filter((r) => r.date != null).map((r) => `${r.date}|${r.meal_type}`),
    );
    const nextKeys = new Set(meals.map((m) => `${m.date}|${m.meal_type}`));
    const changed =
      existingKeys.size !== nextKeys.size || [...existingKeys].some((k) => !nextKeys.has(k));
    if (changed) {
      throw new Error("이미 등록된 신청서의 끼니는 수정할 수 없습니다. 결제 정보만 수정해주세요.");
    }
  }

  // source 는 최초 생성 시점에만 정해진다 — 이미 있는 행(학생이 먼저 낸 신청)을 관리자가 결제만
  // 고치더라도 source 는 'staff' 로 바뀌지 않는다(do update 절에 source 를 넣지 않음).
  const ord = await db.query<{ id: string }>(
    `insert into lunch_order(branch_id, month_id, student_id, source, paid, paid_amount, paid_date, memo)
     values ($1,$2,$3,'staff',$4,$5,$6,$7)
     on conflict (month_id, student_id) do update
       set paid=$4, paid_amount=$5, paid_date=$6, memo=$7, updated_at=now()
     returning id`,
    [branchId, payload.monthId, payload.studentId, paid, paidAmount, payload.paidDate || null, payload.memo || ""],
  );
  const orderId = ord.rows[0].id;

  if (meals.length === 0) {
    await db.query(`delete from lunch_meal where order_id=$1`, [orderId]);
  } else {
    const params: unknown[] = [orderId];
    const insVals: string[] = [];
    const pairVals: string[] = [];
    for (const m of meals) {
      const i = params.length;
      params.push(m.date, m.meal_type);
      insVals.push(`($1, $${i + 1}::date, $${i + 2})`);
      pairVals.push(`($${i + 1}::date, $${i + 2})`);
    }
    await db.query(
      `with ins as (
         insert into lunch_meal(order_id, date, meal_type)
         values ${insVals.join(", ")}
         on conflict (order_id, date, meal_type) do nothing
       )
       delete from lunch_meal
        where order_id=$1
          and (date, meal_type) not in (${pairVals.join(", ")})`,
      params,
    );
  }

  return orderId;
}

// ---------------- 8b. updatePayment (결제 정보 저장 전용 — lunch_meal 은 손대지 않는다) ----------------
// PayPopup(Students.tsx)이 부른다. 화면이 들고 있는 app.meals 는 그 사이 학생이 폼에서 신청을
// 바꿨을 수 있어 낡았을 수 있다 — createApp 처럼 "끼니 변경 여부"를 클라 값으로 판단하면 그
// 낡은 값과 서버 실제 값이 어긋나 결제만 저장하려다 엉뚱하게 거부당한다. 그래서 이 경로는 끼니를
// 아예 안 받는다: 총액은 서버가 lunch_meal 에서 직접 세어 계산한다.
export type UpdatePaymentPayload = {
  orderId: string;
  paidAmount: number;
  paidDate: string | null;
  memo: string;
};
export async function updatePayment(payload: UpdatePaymentPayload): Promise<void> {
  const branchId = await branchOfManage();

  const ord = await db.query<{ id: string; lunch_price: number; dinner_price: number }>(
    `select o.id, mo.lunch_price, mo.dinner_price
       from lunch_order o
       join lunch_month mo on mo.id = o.month_id
      where o.id=$1 and o.branch_id=$2`,
    [payload.orderId, branchId],
  );
  if (!ord.rows[0]) throw new Error("신청서를 찾을 수 없습니다");
  const { lunch_price, dinner_price } = ord.rows[0];

  const meals = await db.query<{ meal_type: MealType }>(
    `select meal_type from lunch_meal where order_id=$1`,
    [payload.orderId],
  );
  const lunchCnt = meals.rows.filter((r) => r.meal_type === "lunch").length;
  const dinnerCnt = meals.rows.filter((r) => r.meal_type === "dinner").length;
  const total = lunchCnt * lunch_price + dinnerCnt * dinner_price;
  const paidAmount = Math.max(0, payload.paidAmount || 0);
  const paid = paidAmount >= total && total > 0;

  await db.query(
    `update lunch_order set paid=$1, paid_amount=$2, paid_date=$3, memo=$4, updated_at=now() where id=$5`,
    [paid, paidAmount, payload.paidDate || null, payload.memo || "", payload.orderId],
  );
}

// ---------------- 9. deleteApp ----------------
export async function deleteApp(id: string): Promise<void> {
  const branchId = await branchOfManage();
  const r = await db.query<{ source: string }>(
    `select source from lunch_order where id=$1 and branch_id=$2`,
    [id, branchId],
  );
  if (!r.rows[0]) return; // 이미 없음 — 조용히 통과(idempotent 삭제)
  if (r.rows[0].source === "student") {
    throw new Error("학생이 직접 신청한 신청서는 관리자가 삭제할 수 없습니다.");
  }
  await db.query(`delete from lunch_order where id=$1 and branch_id=$2`, [id, branchId]);
}

// ---------------- 10. todayOrders (층별 분류 → 신청자 명단) ----------------
export type TodayOrders = {
  today: string;
  lunchTotal: number;
  dinnerTotal: number;
  applicants: { name: string; seat: string | null; meal_type: MealType }[];
};
export async function todayOrders(): Promise<TodayOrders> {
  const branchId = await branchOf();
  const today = todayKey();
  const r = await db.query<{ name: string; seat: string | null; meal_type: MealType }>(
    `select s.name, seat.label as seat, lm.meal_type
       from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
       join student s on s.id = o.student_id
       left join seat on seat.current_student_id = s.id and seat.branch_id = o.branch_id
      where lm.date=$1 and o.branch_id=$2
      order by lm.meal_type, s.name`,
    [today, branchId],
  );
  const lunchTotal = r.rows.filter((x) => x.meal_type === "lunch").length;
  const dinnerTotal = r.rows.filter((x) => x.meal_type === "dinner").length;
  return { today, lunchTotal, dinnerTotal, applicants: r.rows };
}

// ---------------- 신청서 다이얼로그용 학생 검색(신설 — window.api 11개엔 없던 기능) ----------------
export type StudentCandidate = { id: string; name: string; seat: string | null; floor: number | null; alreadyApplied: boolean };
export async function searchStudents(monthId: string, query: string): Promise<StudentCandidate[]> {
  const branchId = await branchOfManage();
  await assertMonth(monthId, branchId);
  const q = query.trim();
  if (!q) return [];
  const r = await db.query<{ id: string; name: string; seat: string | null; floor: number | null; applied: boolean }>(
    `select s.id, s.name, seat.label as seat, room.floor as floor,
            exists(select 1 from lunch_order o where o.month_id=$2 and o.student_id=s.id) as applied
       from student s
       left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
       left join room on room.id = seat.room_id
      where s.branch_id=$1 and s.status='enrolled' and s.name ilike $3
      order by s.name limit 20`,
    [branchId, monthId, `%${q}%`],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, seat: x.seat, floor: x.floor, alreadyApplied: x.applied }));
}
