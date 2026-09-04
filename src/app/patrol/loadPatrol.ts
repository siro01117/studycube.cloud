import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, weekdayOf, minuteOfKST } from "@/lib/date";
import type { DaySlot, Period } from "@/lib/schedule";
import { getOpenPatrolSession, getPatrolPace, type PatrolPace } from "../m/seat/patrolActions";
import type { MRoom, MSeat, MStudent, MScheduleInfo, MActual, MOpenSession } from "./MobilePatrol";

// 터치 순찰 화면(폰 /patrol, 태블릿 /t/patrol) 공용 데이터 로더 — seat/loadSeat.ts 와 같은 이유로 분리.
export type PatrolProps = {
  rooms: MRoom[]; seats: MSeat[]; students: MStudent[];
  attendance: Record<string, "in" | "out">; canManage: boolean; branchKey: string;
  openSession: MOpenSession | null;
  patrolPace: PatrolPace | null;
  scheduleMap: Record<string, MScheduleInfo>;
  periods: Period[];
  actual: MActual;
};

export async function loadPatrolData(): Promise<PatrolProps> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;

  const today = todayKey();
  const jsDow = weekdayOf(today);
  const dbDay = jsDow === 0 ? 7 : jsDow;

  const [rooms, seats, students, att, openSession, patrolPace, hoursRows, ruleRows, excRows, periodRows] = await Promise.all([
    db.query<MRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<MSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<MStudent>(`select id, name from student where branch_id=$1`, [branch]),
    db.query<{ student_id: string; kind: string; at: string; first_in_at: string | null }>(
      `select distinct on (student_id) student_id, kind, at::text as at,
              (min(at) filter (where kind='in') over (partition by student_id))::text as first_in_at
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    getOpenPatrolSession(),
    getPatrolPace(),
    db.query<{ student_id: string; arrive_min: number; leave_min: number }>(
      `select student_id, arrive_min, leave_min from schedule_hours where branch_id=$1 and day=$2`,
      [branch, dbDay],
    ),
    db.query<{ id: string; student_id: string; reason: string; kind: string; start_min: number; end_min: number }>(
      `select id, student_id, reason, kind, start_min, end_min
         from schedule_rule
        where branch_id=$1 and (','||days||',') like ('%,'||$2||',%')`,
      [branch, String(dbDay)],
    ),
    db.query<{ student_id: string; reason: string; kind: string; start_min: number; end_min: number; skip_rule_id: string | null }>(
      `select student_id, reason, kind, start_min, end_min, skip_rule_id
         from schedule_exception where branch_id=$1 and date=$2`,
      [branch, today],
    ),
    db.query<{ start_min: number; end_min: number }>(
      `select start_min, end_min from schedule_period where branch_id=$1 order by ord`,
      [branch],
    ),
  ]);
  const periods: Period[] = periodRows.rows.map((r) => ({ start: r.start_min, end: r.end_min }));

  const attendance: Record<string, "in" | "out"> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";

  const actual: MActual = {};
  for (const r of att.rows) {
    actual[r.student_id] = {
      firstInMin: r.first_in_at ? minuteOfKST(r.first_in_at) : null,
      lastOutMin: r.kind === "out" ? minuteOfKST(r.at) : null,
    };
  }

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

  return {
    rooms: rooms.rows, seats: seats.rows, students: students.rows, attendance,
    canManage: can(me, "patrol.manage"), branchKey: branch ?? "nobranch",
    openSession, patrolPace, scheduleMap, periods, actual,
  };
}
