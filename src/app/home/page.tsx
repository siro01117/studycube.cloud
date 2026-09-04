import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, addDays } from "@/lib/date";
import { todayOrders } from "../m/meal/actions";
import { logoutAction } from "./actions";
import { getNowSnapshot } from "./nowActions";
import HomeView, { type StatItem } from "./HomeView";

export const runtime = "nodejs";

const MIN_TO_HHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// 홈 = "출근해서 처음 여는 화면" = 이제 곧 종합 대시보드다(집주인 지시). 예전엔 모듈 카드 격자가
// 주인공이었지만, 좌측 메뉴(NavRail)가 이미 모듈 진입을 맡고 있어 완전히 같은 일을 두 번 하고
// 있었다 — 그 자리를 "지금 학원이 어떤 상태고 뭐부터 시켜야 하는가"로 바꾼다(nowActions.ts).
// 재무·급여 축은 여기서도 참조조차 하지 않는다(원칙 유지).
export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  const branch = me.activeBranchId;
  const today = todayKey();

  const canLunch = can(me, "lunch.view");
  const canStaffSched = can(me, "staff_schedule.view");
  const canNotice = can(me, "notice.view");
  const canPatrol = can(me, "patrol.view");
  const canSeat = can(me, "seat.view"); // "현장 보기" 버튼(→ /m/seat) 노출 여부 — 그 화면 자체의 guard 와 같은 권한.

  const EMPTY = { rows: [] as never[] };

  const [now, staffRows, unreadNotice, lunch, patrolByPerson] = await Promise.all([
    getNowSnapshot(),
    canStaffSched && branch
      ? db.query<{ name: string; start_min: number }>(
          `select p.name, min(ss.start_min)::int as start_min
             from staff_schedule ss join person p on p.id = ss.person_id
            where ss.branch_id = $1 and ss.date = $2
            group by p.name order by start_min`,
          [branch, today],
        )
      : Promise.resolve(EMPTY),
    canNotice && branch
      ? db.query<{ n: number }>(
          `select count(*)::int as n from notice n
            where n.branch_id = $1 and n.audience = 'staff'
              and not exists (select 1 from notice_read nr where nr.notice_id = n.id and nr.person_id = $2)`,
          [branch, me.id],
        )
      : Promise.resolve({ rows: [{ n: 0 }] }),
    canLunch ? todayOrders().catch(() => null) : Promise.resolve(null),
    // 순찰 횟수·관리자별 편차(최근 4주) — 예전엔 아래 "최근 흐름(참고용)" 트렌드 스트립에 따로
    // 떨어져 있었다. 집주인 지시로 그 스트립은 없앴고, 이 숫자는 "순찰 상태" 카드 안으로 합친다
    // (NowSection.tsx renderPatrol). 도시락 14일 추이 쿼리는 통째로 삭제했다(집주인 지시).
    canPatrol && branch
      ? db.query<{ name: string; n: number }>(
          `select p.name, count(*)::int as n from patrol_session ps join person p on p.id = ps.created_by
            where ps.branch_id=$1 and ps.date>=$2 and ps.date<=$3
            group by p.name order by n desc`,
          [branch, addDays(today, -27), today],
        )
      : Promise.resolve(EMPTY),
  ]);

  const staffToday = staffRows.rows as { name: string; start_min: number }[];
  const unreadNoticeN = unreadNotice.rows[0]?.n ?? 0;
  const lunchN = lunch ? lunch.lunchTotal + lunch.dinnerTotal : null;

  // 오늘 상황을 요약하는 작은 지표 몇 개 — "지금" 카드(NowSection)가 못 다루는 것만(도시락·근무자·
  // 공지). 값이 없는 지표는 배열에 아예 안 넣는다(권한 없는 사람에게 축을 보여주지 않는 원칙).
  const stats: StatItem[] = [
    ...(canLunch ? [{ key: "lunch", label: "오늘 도시락 발주", value: lunchN === null ? "-" : `${lunchN}건`, sub: lunch ? `점심 ${lunch.lunchTotal} · 저녁 ${lunch.dinnerTotal}` : undefined }] : []),
    ...(canStaffSched ? [{ key: "staff", label: "오늘 근무자", value: `${staffToday.length}명`, sub: staffToday.length ? staffToday.map((s) => `${s.name} ${MIN_TO_HHMM(s.start_min)}`).join(" · ") : "배정 없음" }] : []),
    ...(canNotice ? [{ key: "notice", label: "안 읽은 공지", value: `${unreadNoticeN}건`, tone: unreadNoticeN > 0 ? ("warn" as const) : undefined }] : []),
  ];

  const patrolPeople = canPatrol ? (patrolByPerson.rows as { name: string; n: number }[]) : null;

  return (
    <HomeView
      name={me.name}
      today={today}
      now={now}
      stats={stats}
      patrolPeople={patrolPeople}
      fieldHref={canSeat ? "/m/seat" : null}
      logoutAction={logoutAction}
    />
  );
}
