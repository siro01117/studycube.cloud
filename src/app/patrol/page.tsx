import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, weekdayOf } from "@/lib/date";
import type { DaySlot, Period } from "@/lib/schedule";
import { getOpenPatrolSession } from "../m/seat/patrolActions";
import MobilePatrol, { type MRoom, type MSeat, type MStudent, type MScheduleInfo } from "./MobilePatrol";

export const runtime = "nodejs";

// 이 화면 전용 뷰포트 — 브라우저 핀치줌 잠금(캔버스 자체 핀치와 충돌 방지, fixed 바 밀림 방지).
// 전역(layout.tsx)의 태블릿용 핀치 허용 설정은 그대로 둔다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// 모바일 순찰 — 풀스크린(NavRail 없음). 폰 북마크: studycube.cloud/patrol
export default async function MobilePatrolPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;

  // 오늘 요일 — KST 날짜 문자열에서 산출(무인자 new Date() 금지). schedule_rule.days / schedule_hours.day
  // 는 1=월..7=일 좌표계(ScheduleDemo.tsx 와 동일) — JS getUTCDay()(0=일..6=토)에서 변환한다.
  const today = todayKey();
  const jsDow = weekdayOf(today);
  const dbDay = jsDow === 0 ? 7 : jsDow;

  const [rooms, seats, students, att, openSession, hoursRows, ruleRows, excRows, periodRows] = await Promise.all([
    db.query<MRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<MSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<MStudent>(`select id, name from student where branch_id=$1`, [branch]),
    // 오늘 출결(학생별 마지막 이벤트) — 하원 학생 좌석 구분용
    db.query<{ student_id: string; kind: string }>(
      `select distinct on (student_id) student_id, kind
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    // 미종료 순찰 세션 — 있으면 "이어하기"로 전환(액션 내부에서 12h 초과분은 자동 종료)
    getOpenPatrolSession(),
    // 스케쥴 고스트 소스 3쿼리 — 학생 수만큼 루프 쿼리하지 않고 지점 전체를 한 번에 읽어 memory join 한다.
    // 1) 오늘 요일의 학생별 등하원 시각
    db.query<{ student_id: string; arrive_min: number; leave_min: number }>(
      `select student_id, arrive_min, leave_min from schedule_hours where branch_id=$1 and day=$2`,
      [branch, dbDay],
    ),
    // 2) 오늘 요일이 days CSV 에 포함된 정기 일정 — 배열 파라미터 없이 콤마 경계 LIKE 로 매칭
    db.query<{ id: string; student_id: string; reason: string; kind: string; start_min: number; end_min: number }>(
      `select id, student_id, reason, kind, start_min, end_min
         from schedule_rule
        where branch_id=$1 and (','||days||',') like ('%,'||$2||',%')`,
      [branch, String(dbDay)],
    ),
    // 3) 오늘 날짜의 임시 일정(예외) — skip_rule_id 가 있으면 그 정기 일정을 오늘 대체
    db.query<{ student_id: string; reason: string; kind: string; start_min: number; end_min: number; skip_rule_id: string | null }>(
      `select student_id, reason, kind, start_min, end_min, skip_rule_id
         from schedule_exception where branch_id=$1 and date=$2`,
      [branch, today],
    ),
    // 4) 원 운영 시간표(교시) — 지점 단위, 자습 판정에 반영(등하원 안 + 교시 안이어야 자습).
    db.query<{ start_min: number; end_min: number }>(
      `select start_min, end_min from schedule_period where branch_id=$1 order by ord`,
      [branch],
    ),
  ]);
  const periods: Period[] = periodRows.rows.map((r) => ({ start: r.start_min, end: r.end_min }));

  const attendance: Record<string, "in" | "out"> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";

  // studentId → { hours, slots[] } — 오늘 예외가 skip_rule_id 로 대체를 지시한 정기 일정은 제외 처리한다.
  const skippedRuleIds = new Set(excRows.rows.filter((e) => e.skip_rule_id).map((e) => e.skip_rule_id as string));
  const scheduleMap: Record<string, MScheduleInfo> = {};
  const ensure = (sid: string): MScheduleInfo =>
    scheduleMap[sid] ?? (scheduleMap[sid] = { hours: null, slots: [] });
  for (const h of hoursRows.rows) ensure(h.student_id).hours = { arrive_min: h.arrive_min, leave_min: h.leave_min };
  for (const r of ruleRows.rows) {
    if (skippedRuleIds.has(r.id)) continue;
    const slot: DaySlot = { start: r.start_min, end: r.end_min, reason: r.reason, kind: r.kind };
    ensure(r.student_id).slots.push(slot);
  }
  for (const e of excRows.rows) {
    const slot: DaySlot = { start: e.start_min, end: e.end_min, reason: e.reason, kind: e.kind };
    ensure(e.student_id).slots.push(slot);
  }

  return (
    <MobilePatrol
      rooms={rooms.rows}
      seats={seats.rows}
      students={students.rows}
      attendance={attendance}
      canManage={can(me, "patrol.manage")}
      branchKey={branch ?? "nobranch"}
      openSession={openSession}
      scheduleMap={scheduleMap}
      periods={periods}
    />
  );
}
