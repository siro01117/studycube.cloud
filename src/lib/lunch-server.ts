import "server-only";
import { db } from "./db";
import { DEFAULT_NOTICE, type LunchMonth, type Closure } from "./lunch";

// 월 설정 행을 가져오거나(없으면) 기본값으로 생성. 관리·공개 페이지 공용.
export async function getOrCreateMonth(branchId: string, year: number, month: number): Promise<LunchMonth> {
  const sel = `select id, year, month, lunch_label, lunch_price, dinner_label, dinner_price, notice
                 from lunch_month where branch_id=$1 and year=$2 and month=$3`;
  const found = await db.query<LunchMonth>(sel, [branchId, year, month]);
  if (found.rows[0]) return found.rows[0];

  // 새 달을 처음 열 때 그 지점의 가장 최근 달에서 가격(중식·석식)·메뉴 이름·안내문을 승계한다
  // (집주인 지시: "한 번 지정해놨으면 다음 달에 그 값이 기본으로 들어가면 좋겠다. 변화가 있으면
  // 바꾸면 되니까"). 휴무(lunch_closure)는 승계하지 않는다 — 달마다 공휴일·일정이 달라 기본 휴무
  // 규칙(일요일·공휴일·토요일 석식)은 소비 측에서 그때그때 계산한다. 이전 달이 하나도 없으면(그
  // 지점의 첫 도시락 달) 기존처럼 기본값(0원 + DEFAULT_NOTICE)으로 만든다. year/month 로 정렬해
  // "달력상 가장 최근"을 찾는다(created_at 이 아니라) — 과거 달을 나중에 만들어 넣는 경우에도
  // 값이 뒤섞이지 않는다.
  const prev = await db.query<{
    lunch_label: string; lunch_price: number; dinner_label: string; dinner_price: number; notice: string | null;
  }>(
    `select lunch_label, lunch_price, dinner_label, dinner_price, notice
       from lunch_month where branch_id=$1
      order by year desc, month desc limit 1`,
    [branchId],
  );
  const base = prev.rows[0];

  await db.query(
    `insert into lunch_month(branch_id, year, month, lunch_label, lunch_price, dinner_label, dinner_price, notice)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (branch_id, year, month) do nothing`,
    [
      branchId, year, month,
      base?.lunch_label ?? "중식", base?.lunch_price ?? 0,
      base?.dinner_label ?? "석식", base?.dinner_price ?? 0,
      base?.notice ?? DEFAULT_NOTICE,
    ],
  );
  const again = await db.query<LunchMonth>(sel, [branchId, year, month]);
  return again.rows[0];
}

export async function listClosures(monthId: string): Promise<Closure[]> {
  const r = await db.query<Closure>(
    `select date::text as date, lunch_closed, dinner_closed, label
       from lunch_closure where month_id=$1 order by date`,
    [monthId],
  );
  return r.rows;
}
