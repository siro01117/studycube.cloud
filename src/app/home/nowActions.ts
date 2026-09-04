"use server";

// 홈(= 종합 대시보드) "지금" 스냅샷 — 전 직원이 보는 화면이라 branch.settings 로 통째로 막지 않고,
// 지표별로 그 지표를 다루는 권한이 있는 사람에게만 보인다(이 파일이 유일한 출처 — DESIGN.md §9,
// home/page.tsx 최초 렌더와 NowSection.tsx 폴링 양쪽이 이 함수 하나만 부른다). 재무·급여는 원래도
// 이 화면에 올린 적이 없고 여기서도 참조하지 않는다.
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, weekdayOf, minuteOfKST, timeLabel } from "@/lib/date";
import { buildOccupancy, type LastAttRow } from "@/lib/occupancy";
import { getOpenPatrolSession, getPatrolPace, type OpenPatrolSession, type PatrolPace } from "../m/seat/patrolActions";

export type FlaggedStudent = {
  studentId: string; name: string; floor: number | null; seatNumber: number | null;
  state: string; atLabel: string; minutesAgo: number;
};
export type TopPenaltyStudent = { studentId: string; name: string; points: number };
export type NoShowStudent = { studentId: string; name: string; arriveLabel: string; minutesLate: number };
export type FloorOccupancy = { floor: number; occupied: number; total: number };
export type TaskItem = { key: string; label: string; n: number; href: string };

export type NowSnapshot = {
  fetchedAtLabel: string; // "14:32" — 서버가 KST 로 미리 포맷(클라 new Date() 금지 원칙)
  // patrol.view 없으면 null — 카드 자체를 숨긴다.
  patrol: {
    pace: PatrolPace; openSession: OpenPatrolSession | null; urgency: "ok" | "warn" | "danger" | "unknown";
    flagged: FlaggedStudent[]; topPenaltyToday: TopPenaltyStudent[];
  } | null;
  // seat.view/attendance.view 없으면 null.
  seats: { total: number; occupiedNow: number; byFloor: FloorOccupancy[]; arrivedThenLeft: number; noShow: NoShowStudent[] } | null;
  // 각 항목이 개별 권한 + n>0 을 만족할 때만 담긴다(0건은 아예 안 실음 — home/page.tsx 기존 관행).
  tasks: TaskItem[];
};

// "40분째 없음" 이 위로 오게 하는 급함 판정 — 근거는 report 참고.
function patrolUrgency(minutes: number | null): "ok" | "warn" | "danger" | "unknown" {
  if (minutes == null) return "unknown";
  if (minutes >= 40) return "danger";
  if (minutes >= 20) return "warn";
  return "ok";
}

export async function getNowSnapshot(): Promise<NowSnapshot> {
  const me = await getMe();
  if (!me) throw new Error("로그인이 필요합니다");
  await ready();
  const branch = me.activeBranchId;
  if (!branch) return { fetchedAtLabel: timeLabel(new Date().toISOString()), patrol: null, seats: null, tasks: [] };

  const today = todayKey();
  const jsDow = weekdayOf(today);
  const dbDay = jsDow === 0 ? 7 : jsDow;
  const nowMin = minuteOfKST(new Date().toISOString());

  const canOcc = can(me, "seat.view") || can(me, "attendance.view");
  const canPatrol = can(me, "patrol.view");
  const canApproveSchedule = can(me, "schedule.manage");
  const canApproveAccount = can(me, "account.provision");
  const canIssueCode = can(me, "student.edit");
  const canViewSubmission = can(me, "student.view");
  const canViewScheduleGap = can(me, "schedule.view");

  const [attRows, patRows, seatRows, noShowRows, manualPenaltyRows, taskRow, pace, openSession] = await Promise.all([
    // 오늘 학생별 마지막 출결(+첫 입실 시각) — /m/seat 와 같은 쿼리(같은 인덱스 idx_att_event_bd).
    canOcc
      ? db.query<LastAttRow & { first_in_at: string | null }>(
          `select distinct on (student_id) student_id, kind, at::text as at, auto, note,
                  (min(at) filter (where kind='in') over (partition by student_id))::text as first_in_at
             from attendance_event where branch_id=$1 and date=$2
             order by student_id, at desc`,
          [branch, today],
        )
      : Promise.resolve({ rows: [] as (LastAttRow & { first_in_at: string | null })[] }),
    // 오늘 학생별 마지막 순찰 상태 + 오늘 순찰 벌점 합 — 재실 판정(canOcc)과 순찰 카드(canPatrol) 양쪽이
    // 같은 스캔을 나눠 쓴다(둘 중 하나만 있어도 돌린다, patrol_event idx_patrol_* on branch_id,date).
    canOcc || canPatrol
      ? db.query<{
          student_id: string; student_name: string; floor: number | null; seat_number: number | null;
          state: string | null; at: string | null; today_points: number;
        }>(
          `select pe.student_id, s.name as student_name, rm.floor, seat.number as seat_number,
                  (array_agg(pe.state order by pe.at desc))[1] as state,
                  (array_agg(pe.at order by pe.at desc))[1]::text as at,
                  coalesce(sum(pe.points) filter (where pe.points<>0), 0)::int as today_points
             from patrol_event pe
             join student s on s.id = pe.student_id
             left join seat on seat.current_student_id = s.id and seat.branch_id = pe.branch_id
             left join room rm on rm.id = seat.room_id
            where pe.branch_id=$1 and pe.date=$2
            group by pe.student_id, s.name, rm.floor, seat.number`,
          [branch, today],
        )
      : Promise.resolve({ rows: [] as { student_id: string; student_name: string; floor: number | null; seat_number: number | null; state: string | null; at: string | null; today_points: number }[] }),
    canOcc
      ? db.query<{ current_student_id: string | null; floor: number | null }>(
          `select seat.current_student_id, rm.floor from seat left join room rm on rm.id = seat.room_id where seat.branch_id=$1`,
          [branch],
        )
      : Promise.resolve({ rows: [] as { current_student_id: string | null; floor: number | null }[] }),
    canOcc
      ? db.query<{ student_id: string; name: string; arrive_min: number }>(
          `select s.id as student_id, s.name, h.arrive_min
             from student s join schedule_hours h on h.student_id = s.id and h.branch_id=$1 and h.day=$2
            where s.branch_id=$1 and s.status='enrolled'`,
          [branch, dbDay],
        )
      : Promise.resolve({ rows: [] as { student_id: string; name: string; arrive_min: number }[] }),
    canPatrol
      ? db.query<{ student_id: string; name: string; pts: number }>(
          `select pev.student_id, s.name, sum(pev.points)::int as pts
             from penalty_event pev join student s on s.id = pev.student_id
            where pev.branch_id=$1 and pev.date=$2 and pev.points<>0
            group by pev.student_id, s.name`,
          [branch, today],
        )
      : Promise.resolve({ rows: [] as { student_id: string; name: string; pts: number }[] }),
    // 남은 일 — 각 서브쿼리는 권한 있는 사람에게만(없으면 -1 로 표시해 아래서 걸러낸다), 한 왕복.
    db.query<{ schedule_pending: number; submission_pending: number; account_pending: number; no_code: number; no_schedule: number }>(
      `select
         ${canApproveSchedule ? `(select count(*)::int from schedule_request where branch_id=$1 and status='pending')` : "-1"} as schedule_pending,
         ${canViewSubmission ? `(select count(*)::int from submission where branch_id=$1 and status='pending')` : "-1"} as submission_pending,
         ${canApproveAccount ? `(select count(*)::int from account_request where branch_id=$1 and status='pending')` : "-1"} as account_pending,
         ${canIssueCode ? `(select count(*)::int from student where branch_id=$1 and status='enrolled' and access_code is null)` : "-1"} as no_code,
         ${canViewScheduleGap ? `(select count(*)::int from student s where s.branch_id=$1 and s.status='enrolled' and not exists (select 1 from schedule_hours h where h.student_id=s.id))` : "-1"} as no_schedule`,
      [branch],
    ),
    canPatrol ? getPatrolPace() : Promise.resolve(null),
    canPatrol ? getOpenPatrolSession() : Promise.resolve(null),
  ]);

  const occ = buildOccupancy(attRows.rows, patRows.rows, {});

  let seats: NowSnapshot["seats"] = null;
  if (canOcc) {
    const byFloorMap = new Map<number, { occupied: number; total: number }>();
    let total = 0, occupiedNow = 0;
    for (const r of seatRows.rows) {
      total++;
      const floor = r.floor ?? 0;
      const entry = byFloorMap.get(floor) ?? { occupied: 0, total: 0 };
      entry.total++;
      if (r.current_student_id && occ[r.current_student_id]?.kind === "in") { entry.occupied++; occupiedNow++; }
      byFloorMap.set(floor, entry);
    }
    const byFloor = [...byFloorMap.entries()].sort((a, b) => a[0] - b[0]).map(([floor, v]) => ({ floor, occupied: v.occupied, total: v.total }));
    const arrivedThenLeft = attRows.rows.filter((r) => r.first_in_at && occ[r.student_id]?.kind === "out").length;

    const GRACE_MIN = 15;
    const seenToday = new Set<string>([...attRows.rows.map((r) => r.student_id), ...patRows.rows.map((r) => r.student_id)]);
    const noShow: NoShowStudent[] = noShowRows.rows
      .filter((r) => !seenToday.has(r.student_id) && nowMin >= r.arrive_min + GRACE_MIN)
      .map((r) => ({
        studentId: r.student_id, name: r.name,
        arriveLabel: `${String(Math.floor(r.arrive_min / 60)).padStart(2, "0")}:${String(r.arrive_min % 60).padStart(2, "0")}`,
        minutesLate: nowMin - r.arrive_min,
      }))
      .sort((a, b) => b.minutesLate - a.minutesLate)
      .slice(0, 20);

    seats = { total, occupiedNow, byFloor, arrivedThenLeft, noShow };
  }

  let patrol: NowSnapshot["patrol"] = null;
  if (canPatrol && pace) {
    const nowMs = Date.now();
    const flagged: FlaggedStudent[] = patRows.rows
      .filter((r) => r.state === "sleep" || r.state === "distract")
      .map((r) => ({
        studentId: r.student_id, name: r.student_name, floor: r.floor, seatNumber: r.seat_number,
        state: r.state as string, atLabel: r.at ? timeLabel(r.at) : "",
        minutesAgo: r.at ? Math.max(0, Math.floor((nowMs - Date.parse(r.at)) / 60000)) : 0,
      }))
      .sort((a, b) => b.minutesAgo - a.minutesAgo)
      .slice(0, 20);

    const ptsMap = new Map<string, { name: string; pts: number }>();
    for (const r of patRows.rows) {
      if (!r.today_points) continue;
      ptsMap.set(r.student_id, { name: r.student_name, pts: (ptsMap.get(r.student_id)?.pts ?? 0) + r.today_points });
    }
    for (const r of manualPenaltyRows.rows) {
      if (!r.pts) continue;
      const prev = ptsMap.get(r.student_id);
      ptsMap.set(r.student_id, { name: prev?.name ?? r.name, pts: (prev?.pts ?? 0) + r.pts });
    }
    const topPenaltyToday = [...ptsMap.entries()].map(([studentId, v]) => ({ studentId, name: v.name, points: v.pts })).sort((a, b) => b.points - a.points).slice(0, 5);

    patrol = { pace, openSession, urgency: patrolUrgency(pace.minutes), flagged, topPenaltyToday };
  }

  const t = taskRow.rows[0];
  const tasks: TaskItem[] = [
    ...(t && t.schedule_pending > 0 ? [{ key: "schedule", label: "스케쥴 변경 신청 대기", n: t.schedule_pending, href: "/m/schedule" }] : []),
    ...(t && t.submission_pending > 0 ? [{ key: "submission", label: "신청·설문 대기", n: t.submission_pending, href: "/m/submission" }] : []),
    ...(t && t.account_pending > 0 ? [{ key: "account", label: "계정 발급 요청 대기", n: t.account_pending, href: "/m/staff" }] : []),
    ...(t && t.no_code > 0 ? [{ key: "nocode", label: "접속 코드 미발급", n: t.no_code, href: "/m/student" }] : []),
    ...(t && t.no_schedule > 0 ? [{ key: "noschedule", label: "등하원 스케쥴 미제출", n: t.no_schedule, href: "/m/schedule" }] : []),
  ];

  return { fetchedAtLabel: timeLabel(new Date().toISOString()), patrol, seats, tasks };
}
