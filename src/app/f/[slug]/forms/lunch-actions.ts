"use server";

// 도시락 신청 폼(lch4k9wp.tsx) 전용 서버 액션. 저장은 submission 이 아니라 lunch_order/lunch_meal 에
// 직접(f/actions.ts 의 submitForm 을 거치지 않는다) — 완전 신청제 게시판형이 아니라 월 단위로 계속
// 고쳐 쓰는 상태 저장이라서 다른 공개 폼들과 저장 방식이 다르다.
//
// 본인확인은 다른 공개 폼과 같은 원칙 — 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시 찾는다.
// 마감 판정(mealLocked)·다음 달 개방 판정(nextMonthOpenDay)은 src/lib/lunch.ts 의 순수 함수를 그대로
// 쓴다 — 이 파일과 화면(lch4k9wp.tsx)이 같은 함수를 써야 클라·서버 판정이 어긋나지 않는다.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { getOrCreateMonth, listClosures } from "@/lib/lunch-server";
import { todayKey, minuteOfKST } from "@/lib/date";
import {
  dowOf, mealAvailable, mealLocked, nextMonthOpenDay, nextYm,
  type LunchMonth, type Closure, type MealType,
} from "@/lib/lunch";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const MAX_MEALS = 100; // 한 달 최대 슬롯(≈62)보다 넉넉한 상한
export type Tab = "current" | "next";

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

/** KST 기준 지금 시각의 자정부터 경과분(0~1439). 클라 렌더에서 new Date() 를 못 쓰므로 서버가
 *  스냅샷을 만들어 내려준다(요청 시점 값 — 화면을 오래 열어둔 채 8시를 넘기면 다시 조회해야 갱신됨). */
function nowMinKst(): number {
  return minuteOfKST(new Date().toISOString());
}

type IdentityResult =
  | { ok: true; studentId: string; studentName: string; testBypass: false }
  | { ok: true; studentId: null; studentName: string; testBypass: true }
  | { ok: false; error: string; kind?: "identity" };

/** DEV-ONLY 테스트 신원(허브 "테스트로 건너뛰기") 은 실제 student 행이 없어 student_id not null 인
 *  lunch_order 에 쓸 수 없다 — f/[slug]/forms/schedule-request-actions.ts verifyIdentity 와 동일 원칙. */
async function verifyIdentity(formData: FormData): Promise<IdentityResult> {
  const name = s(formData.get("name"));
  const code = s(formData.get("code"));
  if (process.env.NODE_ENV !== "production" && s(formData.get("test")) === "1") {
    return { ok: true, studentId: null, studentName: name || "테스트", testBypass: true };
  }
  const match = await findStudent(name, code);
  if (!match.ok) return { ok: false, error: publicAuthError(match.reason), kind: "identity" };
  return { ok: true, studentId: match.id, studentName: match.name, testBypass: false };
}

/** tab → 대상 연·월. "next" 인데 아직 25일 전이면 ok:false(클라가 잠긴 탭을 우회 호출한 경우 대비). */
function resolveYm(tab: Tab, today: string): { ok: true; year: number; month: number } | { ok: false; error: string } {
  const [y, m] = today.split("-").map(Number);
  if (tab === "current") return { ok: true, year: y, month: m };
  if (!nextMonthOpenDay(today)) return { ok: false, error: "다음 달 신청은 25일부터 열려요." };
  const nx = nextYm(y, m);
  return { ok: true, year: nx.year, month: nx.month };
}

export type LunchDataResult =
  | { ok: false; error: string; kind?: "identity" }
  | {
      ok: true;
      studentName: string;
      isTest: boolean;
      today: string;
      nowMin: number;
      nextOpen: boolean; // 다음 달 탭 개방 여부(오늘 기준) — 클라가 탭 자체를 잠글지 결정
      month: LunchMonth;
      closures: Closure[];
      myMeals: { date: string; meal_type: MealType }[];
    };

/** FormData: slug, name, code, (개발전용) test, tab("current"|"next"). */
export async function getLunchData(formData: FormData): Promise<LunchDataResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;

  const tab: Tab = s(formData.get("tab")) === "next" ? "next" : "current";
  const today = todayKey();
  const nextOpen = nextMonthOpenDay(today);
  const ym = resolveYm(tab, today);
  if (!ym.ok) return { ok: false, error: ym.error };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const month = await getOrCreateMonth(branch, ym.year, ym.month);
  const closures = await listClosures(month.id);

  if (id.testBypass || !id.studentId) {
    return { ok: true, studentName: id.studentName, isTest: true, today, nowMin: nowMinKst(), nextOpen, month, closures, myMeals: [] };
  }

  const meals = await db.query<{ date: string; meal_type: MealType }>(
    `select lm.date::text as date, lm.meal_type from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
      where o.month_id=$1 and o.student_id=$2 order by lm.date`,
    [month.id, id.studentId],
  );
  return { ok: true, studentName: id.studentName, isTest: false, today, nowMin: nowMinKst(), nextOpen, month, closures, myMeals: meals.rows };
}

export type SaveLunchResult = { ok: true } | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test, tab, meals(JSON.stringify({date,meal_type}[])).
 *  meals 는 "아직 마감되지 않은 끼니" 구간의 최종 상태 전체만 담아 보낸다(잠긴 날짜는 아예 포함하지
 *  않는 것이 정상 — 포함돼 있으면 클라·서버 판정이 어긋났다는 뜻이므로 요청 전체를 거부한다). */
export async function saveLunchOrder(formData: FormData): Promise<SaveLunchResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    return { ok: false, error: "테스트 신원으로는 저장할 수 없어요. 실제 학생으로 접속해주세요." };
  }
  const studentId = id.studentId;

  const tab: Tab = s(formData.get("tab")) === "next" ? "next" : "current";
  const today = todayKey();
  const nowMin = nowMinKst();
  const ym = resolveYm(tab, today);
  if (!ym.ok) return { ok: false, error: ym.error };

  let mealsRaw: unknown;
  try {
    mealsRaw = JSON.parse(s(formData.get("meals")) || "[]");
  } catch {
    return { ok: false, error: "요청이 올바르지 않습니다." };
  }
  if (!Array.isArray(mealsRaw)) return { ok: false, error: "요청이 올바르지 않습니다." };
  if (mealsRaw.length > MAX_MEALS) return { ok: false, error: "신청 개수가 너무 많습니다." };

  const ymPrefix = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const seen = new Set<string>();
  const meals: { date: string; meal_type: MealType }[] = [];
  for (const raw of mealsRaw) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "요청이 올바르지 않습니다." };
    const r = raw as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date : "";
    const mealType = r.meal_type;
    if ((mealType !== "lunch" && mealType !== "dinner") || !date.startsWith(ymPrefix)) {
      return { ok: false, error: "요청이 올바르지 않습니다." };
    }
    const key = `${date}|${mealType}`;
    if (seen.has(key)) continue; // 같은 항목 중복 전송은 조용히 합침(교체 결과는 동일하므로)
    seen.add(key);
    meals.push({ date, meal_type: mealType });
  }

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const month = await getOrCreateMonth(branch, ym.year, ym.month);
  const closures = await listClosures(month.id);
  const closureBy = new Map(closures.map((c) => [c.date, c]));
  const todayEditable = nowMin < 8 * 60;

  // 결함 4: 가격 미설정 달(중식·석식 가격 모두 0) — 신청이 "늘어나는" 경우만 거부한다. 원래
  // meals.length > 0 이면 무조건 거부해서 전부 취소는 되는데 일부만 취소하는 건 막히는 모순이
  // 있었다(취소는 언제나 가능해야 한다) — 이 함수가 교체 대상으로 삼는 "아직 마감 안된" 구간의
  // 기존 개수와 비교해 늘어날 때만 막는다. 클라(lch4k9wp.tsx)와 같은 판정 기준을 쓴다.
  const priceUnset = month.lunch_price === 0 && month.dinner_price === 0;
  if (priceUnset && meals.length > 0) {
    const existingCountRes = await db.query<{ cnt: string }>(
      `select count(*)::text as cnt
         from lunch_meal lm
         join lunch_order o on o.id = lm.order_id
        where o.month_id=$1 and o.student_id=$2 and (lm.date > $3 or ($4 and lm.date = $3))`,
      [month.id, studentId, today, todayEditable],
    );
    const existingCount = Number(existingCountRes.rows[0]?.cnt ?? 0);
    if (meals.length > existingCount) {
      return { ok: false, error: "이 달은 아직 가격이 정해지지 않았어요. 카운터에 문의해주세요." };
    }
  }

  // 서버 재검증 — 클라가 잠긴(마감된) 끼니나 휴무일 끼니를 하나라도 보내면, 그 항목만 걸러내지 않고
  // 요청 전체를 거부한다(클라·서버 판정이 어긋났다는 신호이므로 조용히 잘라내지 않는다).
  for (const mm of meals) {
    if (mealLocked(mm.date, mm.meal_type, today, nowMin)) {
      return { ok: false, error: "마감된 끼니가 포함돼 있어요. 화면을 새로고침한 뒤 다시 시도해주세요." };
    }
    if (!mealAvailable(mm.date, dowOf(mm.date), mm.meal_type, closureBy)) {
      return { ok: false, error: "휴무일 끼니가 포함돼 있어요. 화면을 새로고침한 뒤 다시 시도해주세요." };
    }
  }

  // 주문(월×학생) 확보. source는 최초 생성 시점에만 정해진다 — 이미 있는 행(관리자가 먼저 만든
  // staff 신청)을 학생이 고치더라도 source 는 바뀌지 않는다(do update 절에 source 를 넣지 않음).
  const ord = await db.query<{ id: string }>(
    `insert into lunch_order(branch_id, month_id, student_id, source) values ($1,$2,$3,'student')
     on conflict (month_id, student_id) do update set updated_at=now()
     returning id`,
    [branch, month.id, studentId],
  );
  const orderId = ord.rows[0].id;

  // "아직 마감되지 않은 끼니" 구간(date > today, 또는 오늘이면서 아직 8시 전)만 원자적으로 교체한다.
  // 이 범위 밖(마감된 과거·오늘 8시 이후 신청분)은 delete/insert 어느 쪽 대상도 아니므로 그대로 보존된다
  // (CTE 한 방으로 delete+insert 를 묶어, 중간에 실패해도 반쪽만 반영되는 일이 없게 한다). todayEditable
  // 은 위에서(가격 가드) 이미 계산해뒀다.
  if (meals.length === 0) {
    await db.query(
      `delete from lunch_meal where order_id=$1 and (date > $2 or ($3 and date = $2))`,
      [orderId, today, todayEditable],
    );
  } else {
    const params: (string | boolean)[] = [orderId, today, todayEditable];
    const insVals: string[] = [];
    const pairVals: string[] = [];
    for (const mm of meals) {
      const i = params.length;
      params.push(mm.date, mm.meal_type);
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
        where order_id=$1 and (date > $2 or ($3 and date = $2))
          and (date, meal_type) not in (${pairVals.join(", ")})`,
      params,
    );
  }

  return { ok: true };
}
