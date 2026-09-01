"use server";

// 도시락 신청 폼(lch4k9wp.tsx) 전용 서버 액션. 저장은 submission 이 아니라 lunch_order/lunch_meal 에
// 직접(f/actions.ts 의 submitForm 을 거치지 않는다) — 완전 신청제 게시판형이 아니라 월 단위로 계속
// 고쳐 쓰는 상태 저장이라서 다른 공개 폼들과 저장 방식이 다르다.
//
// 본인확인은 다른 공개 폼과 같은 원칙 — 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시 찾는다.
// 마감 판정(mealLocked)은 src/lib/lunch.ts 의 순수 함수를 그대로 쓴다 — 이 파일과 화면(lch4k9wp.tsx)이
// 같은 함수를 써야 클라·서버 판정이 어긋나지 않는다.
// 다음 달 탭은 날짜 제한 없이 항상 연다(과거엔 25일부터만 열었으나 폐지) — "아직 준비 안 된 달"
// 가드는 가격 미설정 체크(priceUnset, 아래 saveLunchOrder)가 더 정확하게 이미 수행한다.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { getOrCreateMonth, listClosures } from "@/lib/lunch-server";
import { todayKey, minuteOfKST } from "@/lib/date";
import {
  dowOf, mealAvailable, mealLocked, nextYm,
  type LunchMonth, type Closure, type MealType,
} from "@/lib/lunch";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const MAX_MEALS = 100; // 한 달 최대 슬롯(≈62)보다 넉넉한 상한
export type Tab = "current" | "next";

/** 끼니 종류 → 그 달의 단가. 여러 곳에서 같은 삼항식이 반복되던 것을 하나로 묶었다. */
const mealPrice = (month: LunchMonth, mealType: MealType): number =>
  mealType === "lunch" ? month.lunch_price : month.dinner_price;

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

/** tab → 대상 연·월. "next" 는 날짜 제한 없이 항상 다음 달을 연다. */
function resolveYm(tab: Tab, today: string): { ok: true; year: number; month: number } | { ok: false; error: string } {
  const [y, m] = today.split("-").map(Number);
  if (tab === "current") return { ok: true, year: y, month: m };
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
      month: LunchMonth;
      closures: Closure[];
      // price = 신청 시점 단가 스냅샷(lunch_meal.price). 관리자 화면(actions.ts listApps)과 같은 원칙으로
      // 학생 화면 총액도 이 값을 합산해야 한다(예전엔 학생 화면만 월의 "현재" 가격을 다시 곱해서
      // 관리자 화면과 금액이 달라졌다). 아직 저장되지 않은(이번 세션에 새로 고른) 끼니는 여기 없다 —
      // 그건 화면이 현재 월 가격으로 계산한다(저장하면 그 가격으로 굳으니까).
      myMeals: { date: string; meal_type: MealType; price: number }[];
    };

/** FormData: slug, name, code, (개발전용) test, tab("current"|"next"). */
export async function getLunchData(formData: FormData): Promise<LunchDataResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;

  const tab: Tab = s(formData.get("tab")) === "next" ? "next" : "current";
  const today = todayKey();
  const ym = resolveYm(tab, today);
  if (!ym.ok) return { ok: false, error: ym.error };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const month = await getOrCreateMonth(branch, ym.year, ym.month);
  const closures = await listClosures(month.id);

  if (id.testBypass || !id.studentId) {
    return { ok: true, studentName: id.studentName, isTest: true, today, nowMin: nowMinKst(), month, closures, myMeals: [] };
  }

  const meals = await db.query<{ date: string; meal_type: MealType; price: number }>(
    `select lm.date::text as date, lm.meal_type, lm.price from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
      where o.month_id=$1 and o.student_id=$2 order by lm.date`,
    [month.id, id.studentId],
  );
  return { ok: true, studentName: id.studentName, isTest: false, today, nowMin: nowMinKst(), month, closures, myMeals: meals.rows };
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

  // 기존(교체 대상 구간 = 아직 마감 안 된 끼니)에 이미 있던 끼니 목록. 가격 미설정 가드("새로
  // 추가될 때만 막는다")와 휴무 가드(마찬가지로 "새로 추가될 때만 막는다") 둘 다 이 집합을 기준으로
  // 삼는다 — 한 번 조회로 재사용한다.
  const existingRes = await db.query<{ date: string; meal_type: MealType }>(
    `select lm.date::text as date, lm.meal_type
       from lunch_meal lm
       join lunch_order o on o.id = lm.order_id
      where o.month_id=$1 and o.student_id=$2 and (lm.date > $3 or ($4 and lm.date = $3))`,
    [month.id, studentId, today, todayEditable],
  );
  const existingSet = new Set(existingRes.rows.map((r) => `${r.date}|${r.meal_type}`));

  // key 는 한 번만 만들어 아래 두 검사가 재사용한다. 검사 순서(가격 → 마감 → 휴무)를 지키려면
  // 두 패스가 필요하다 — 한 패스로 합쳐 항목별로 번갈아 검사하면 뒤 항목의 가격 오류보다 앞 항목의
  // 마감 오류가 먼저 나가 순서가 바뀐다.
  const withKey = meals.map((mm) => ({ ...mm, key: `${mm.date}|${mm.meal_type}` }));

  // 가격 미설정은 "달 전체(중식·석식 둘 다 0)"가 아니라 끼니별로 판정한다 — 중식만 0원인 달이면
  // 중식만 막고 석식은 정상 신청된다(예전엔 둘 다 0일 때만 막아서 반쪽 가격 달이 샜다). 또한 개수
  // 비교가 아니라 existingSet(위) 기준 집합 비교로 "새로 추가되는" 끼니만 본다 — 개수 비교였을
  // 때는 취소 1 + 추가 1 처럼 총 개수는 같지만 알맹이가 바뀐 요청이 통과해 price=0 인 행이 몰래
  // 들어올 수 있었다. 클라(lch4k9wp.tsx)와 같은 기준을 쓴다.
  for (const mm of withKey) {
    if (existingSet.has(mm.key)) continue; // 기존 유지는 항상 허용(취소는 별도로 항상 허용)
    if (mealPrice(month, mm.meal_type) === 0) {
      return { ok: false, error: "이 달은 아직 가격이 정해지지 않았어요. 카운터에 문의해주세요." };
    }
  }

  // 서버 재검증 — 클라가 잠긴(마감된) 끼니를 하나라도 보내면 요청 전체를 거부한다(클라·서버 판정이
  // 어긋났다는 신호이므로 조용히 잘라내지 않는다). 휴무일 끼니는 원칙이 다르다: 관리자가 "신청이
  // 이미 있던 날"을 나중에 휴무로 바꿀 수 있으므로, 이미 있던 휴무 끼니를 그대로 유지하거나 빼는
  // 것(취소)은 항상 허용하고, "새로 추가"되는 휴무 끼니만 거부한다(가격 가드와 같은 원칙).
  for (const mm of withKey) {
    if (mealLocked(mm.date, mm.meal_type, today, nowMin)) {
      return { ok: false, error: "마감된 끼니가 포함돼 있어요. 화면을 새로고침한 뒤 다시 시도해주세요." };
    }
    if (!mealAvailable(mm.date, dowOf(mm.date), mm.meal_type, closureBy) && !existingSet.has(mm.key)) {
      return { ok: false, error: "휴무일에 새로 신청할 수는 없어요. 화면을 새로고침한 뒤 다시 시도해주세요." };
    }
  }

  const ord = await db.query<{ id: string }>(
    `insert into lunch_order(branch_id, month_id, student_id) values ($1,$2,$3)
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
    const params: (string | number | boolean)[] = [orderId, today, todayEditable];
    const insVals: string[] = [];
    const pairVals: string[] = [];
    for (const mm of meals) {
      const i = params.length;
      const price = mealPrice(month, mm.meal_type);
      params.push(mm.date, mm.meal_type, price);
      insVals.push(`($1, $${i + 1}::date, $${i + 2}, $${i + 3})`);
      pairVals.push(`($${i + 1}::date, $${i + 2})`);
    }
    // price 는 신청 시점 단가 스냅샷 — on conflict do nothing 이므로 이미 있던(유지되는) 행의 기존
    // 스냅샷은 덮어쓰지 않는다. 새로 추가되는 행만 지금 월 가격으로 기록된다.
    await db.query(
      `with ins as (
         insert into lunch_meal(order_id, date, meal_type, price)
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
