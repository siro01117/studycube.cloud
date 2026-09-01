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
import { dowOf, mealAvailable, type LunchMonth, type Closure, type MealType } from "@/lib/lunch";

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
  // price = 신청 시점 단가 스냅샷 — 화면은 이 값을 합산해 총액을 낸다. 월의 "현재" 가격을
  // 다시 곱하지 않는다(그러면 관리자가 가격을 바꿀 때마다 과거 신청의 총액·완납 상태가 흔들린다).
  meals: { date: string; meal_type: MealType; price: number }[];
};

const APP_SELECT = `
  select o.id, o.month_id, o.student_id as "studentId",
         s.name, seat.label as seat, room.floor as floor,
         o.paid, o.paid_amount, o.paid_date::text as paid_date, coalesce(o.memo, '') as memo,
         coalesce(
           json_agg(json_build_object('date', lm.date::text, 'meal_type', lm.meal_type, 'price', lm.price) order by lm.date)
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
    paid: !!r.paid,
    paid_amount: (r.paid_amount as number) ?? 0,
    paid_date: (r.paid_date as string | null) ?? null,
    memo: (r.memo as string) ?? "",
    meals: (asJson(r.meals) as { date: string; meal_type: MealType; price: number }[]) ?? [],
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
  // 신청 뒤 관리자가 휴무로 바꾼 끼니는 발주(todayOrders)에서 빼듯 청구 화면(Students.tsx의
  // getStats/PayPopup)에서도 뺀다 — 만들지도 않은 도시락이 청구되면 안 된다. 여기서 meals 배열 자체를
  // 걸러내면 화면은 손대지 않아도 자동으로 같은 기준을 따른다(updatePayment 도 같은 기준을 쓴다).
  const closures = await listClosuresDb(monthId);
  const closureBy = new Map(closures.map((c) => [c.date, c]));
  return r.rows.map(rowToApp).map((a) => ({
    ...a,
    meals: a.meals.filter((mm) => mealAvailable(mm.date, dowOf(mm.date), mm.meal_type, closureBy)),
  }));
}

// ---------------- 8b. updatePayment (결제 정보 저장 전용 — lunch_meal 은 손대지 않는다) ----------------
// PayPopup(Students.tsx)이 부른다. 화면이 들고 있는 app.meals 는 그 사이 학생이 폼에서 신청을
// 바꿨을 수 있어 낡았을 수 있다 — "끼니 변경 여부"를 클라 값으로 판단하면 그 낡은 값과 서버 실제
// 값이 어긋나 결제만 저장하려다 엉뚱하게 거부당한다. 그래서 이 경로는 끼니를 아예 안 받는다:
// 총액은 서버가 lunch_meal 에서 직접 세어 계산한다. 도시락 등록·수정은 학생 폼(lunch-actions.ts)
// 전용이다 — 관리자 쪽에서 lunch_meal 을 쓰는 경로는 이 파일에 없다.
export type UpdatePaymentPayload = {
  orderId: string;
  paidAmount: number;
  paidDate: string | null;
  memo: string;
};
export async function updatePayment(payload: UpdatePaymentPayload): Promise<void> {
  const branchId = await branchOfManage();

  const ord = await db.query<{ id: string; month_id: string }>(
    `select o.id, o.month_id from lunch_order o where o.id=$1 and o.branch_id=$2`,
    [payload.orderId, branchId],
  );
  if (!ord.rows[0]) throw new Error("신청서를 찾을 수 없습니다");

  // 총액은 신청 시점 단가 스냅샷(lunch_meal.price) 합계로 낸다 — 월의 "현재" 가격을 다시
  // 곱하지 않는다. 그래야 관리자가 가격을 바꿔도 이미 완납한 신청이 미납으로 되돌아가지 않는다.
  // 그 중 신청 뒤 휴무로 바뀐 끼니는 listApps 와 같은 기준(mealAvailable)으로 빼고 합산한다 —
  // 만들지도 않은 도시락이 청구되면 안 된다.
  const closures = await listClosuresDb(ord.rows[0].month_id);
  const closureBy = new Map(closures.map((c) => [c.date, c]));
  const mealsRes = await db.query<{ date: string; meal_type: MealType; price: number }>(
    `select date::text as date, meal_type, price from lunch_meal where order_id=$1`,
    [payload.orderId],
  );
  const total = mealsRes.rows
    .filter((mm) => mealAvailable(mm.date, dowOf(mm.date), mm.meal_type, closureBy))
    .reduce((sum, mm) => sum + mm.price, 0);
  const paidAmount = Math.max(0, payload.paidAmount || 0);
  const paid = paidAmount >= total && total > 0;

  await db.query(
    `update lunch_order set paid=$1, paid_amount=$2, paid_date=$3, memo=$4, updated_at=now() where id=$5`,
    [paid, paidAmount, payload.paidDate || null, payload.memo || "", payload.orderId],
  );
}

// ---------------- 9. mealCountOn (특정 날짜의 끼니별 기존 신청 건수) ----------------
// MonthSettings 가 휴무 지정(setClosure) 직전에 부른다 — 이미 신청이 있는 날을 휴무로 바꾸면
// 그 학생들은 취소만 가능해지므로, 지정 전에 관리자에게 건수를 보여주고 확인받는다.
export async function mealCountOn(monthId: string, date: string): Promise<{ lunch: number; dinner: number }> {
  // 휴무 지정(setClosure) 직전 확인 용도로만 쓰이는 관리 흐름 — 형제 쓰기 경로(setClosure 등)와
  // 같이 조회 권한(lunch.view)이 아니라 관리 권한(lunch.manage)으로 인가한다.
  const branchId = await branchOfManage();
  await assertMonth(monthId, branchId);
  const r = await db.query<{ meal_type: MealType; cnt: string }>(
    `select lm.meal_type, count(*)::text as cnt
       from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
      where o.month_id=$1 and lm.date=$2
      group by lm.meal_type`,
    [monthId, date],
  );
  const out = { lunch: 0, dinner: 0 };
  for (const row of r.rows) out[row.meal_type] = Number(row.cnt);
  return out;
}

// ---------------- 10. todayOrders (층별 분류 → 신청자 명단) ----------------
export type TodayOrders = {
  today: string;
  lunchTotal: number;
  dinnerTotal: number;
  applicants: { name: string; seat: string | null; meal_type: MealType }[];
  // 신청은 있었지만 그 사이 관리자가 휴무로 지정한 끼니는 발주 수량·명단에서 뺀다(학생은
  // 취소만 가능한 상태로 화면에 남는다). 그 건수를 완전히 숨기지 않고 관리자에게 알린다.
  excludedClosed: number;
};
export async function todayOrders(): Promise<TodayOrders> {
  const branchId = await branchOf();
  const today = todayKey();
  const r = await db.query<{ name: string; seat: string | null; meal_type: MealType; date: string }>(
    `select s.name, seat.label as seat, lm.meal_type, lm.date::text as date
       from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
       join student s on s.id = o.student_id
       left join seat on seat.current_student_id = s.id and seat.branch_id = o.branch_id
      where lm.date=$1 and o.branch_id=$2
      order by lm.meal_type, s.name`,
    [today, branchId],
  );

  // 오늘이 속한 달의 휴무 오버라이드만 가져온다 — 월 행이 아직 없으면(신청이 있으니 사실상 없을 수
  // 없지만 방어적으로) 오버라이드 없이 기본 휴무 규칙(일요일·공휴일·토요일 석식)만 적용된다.
  const [y, m] = today.split("-").map(Number);
  const monthRow = await db.query<{ id: string }>(
    `select id from lunch_month where branch_id=$1 and year=$2 and month=$3`,
    [branchId, y, m],
  );
  const closures = monthRow.rows[0] ? await listClosuresDb(monthRow.rows[0].id) : [];
  const closureBy = new Map(closures.map((c) => [c.date, c]));
  const dow = dowOf(today);

  const open = r.rows.filter((x) => mealAvailable(x.date, dow, x.meal_type, closureBy));
  const excludedClosed = r.rows.length - open.length;
  const lunchTotal = open.filter((x) => x.meal_type === "lunch").length;
  const dinnerTotal = open.filter((x) => x.meal_type === "dinner").length;
  return {
    today, lunchTotal, dinnerTotal, excludedClosed,
    applicants: open.map(({ name, seat, meal_type }) => ({ name, seat, meal_type })),
  };
}
