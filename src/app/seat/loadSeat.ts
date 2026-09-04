import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, weekdayOf, minuteOfKST } from "@/lib/date";
import { buildOccupancy, type SeatOcc } from "@/lib/occupancy";
import type { DaySlot, Period, ActualAttendance } from "@/lib/schedule";
import type { SRoom, SSeat, SStudent, SScheduleInfo } from "./MobileSeat";

// 터치 좌석 배치도 화면(폰 /seat, 태블릿 /t/seat) 공용 데이터 로더 — 권한 검사·쿼리를 한 곳에 둬서
// 화면이 늘어나도(폰/태블릿) 검사가 갈라지지 않게 한다. 크기(phone/tablet)는 이 함수가 모른다 —
// 순수하게 "누가 볼 수 있는가"와 "무엇을 보여줄까"만 여기서 정하고, 어떻게 보여줄지는 각 page.tsx 가 정한다.
export type SeatProps = {
  rooms: SRoom[]; seats: SSeat[]; students: SStudent[];
  occupancy: Record<string, SeatOcc>; canAttend: boolean;
  scheduleMap: Record<string, SScheduleInfo>;
  periods: Period[];
  actual: Record<string, ActualAttendance>;
  nowMin: number;
};

export async function loadSeatData(): Promise<SeatProps> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "seat.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;

  const today = todayKey();
  const jsDow = weekdayOf(today);
  const dbDay = jsDow === 0 ? 7 : jsDow;

  const [rooms, seats, students, att, pat, hoursRows, ruleRows, excRows, periodRows] = await Promise.all([
    db.query<SRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<SSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<SStudent>(
      `select id, name, grade, school, student_phone, guardian_phone from student where branch_id=$1`,
      [branch],
    ),
    db.query<{ student_id: string; kind: string; at: string; auto: boolean; note: string | null; first_in_at: string | null }>(
      `select distinct on (student_id) student_id, kind, at::text as at, auto, note,
              (min(at) filter (where kind='in') over (partition by student_id))::text as first_in_at
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    db.query<{ student_id: string; state: string; at: string }>(
      `select distinct on (student_id) student_id, state, at::text as at
         from patrol_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
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

  const skippedRuleIds = new Set(excRows.rows.filter((e) => e.skip_rule_id).map((e) => e.skip_rule_id as string));
  const scheduleMap: Record<string, SScheduleInfo> = {};
  const ensureSchedule = (sid: string): SScheduleInfo =>
    scheduleMap[sid] ?? (scheduleMap[sid] = { hours: null, slots: [] });
  for (const h of hoursRows.rows) ensureSchedule(h.student_id).hours = { arrive_min: h.arrive_min, leave_min: h.leave_min };
  for (const r of ruleRows.rows) {
    if (skippedRuleIds.has(r.id)) continue;
    const slot: DaySlot = { start: r.start_min, end: r.end_min, reason: r.reason, kind: r.kind };
    ensureSchedule(r.student_id).slots.push(slot);
  }
  for (const e of excRows.rows) {
    const slot: DaySlot = { start: e.start_min, end: e.end_min, reason: e.reason, kind: e.kind };
    ensureSchedule(e.student_id).slots.push(slot);
  }

  const occupancy: Record<string, SeatOcc> = buildOccupancy(att.rows, pat.rows, scheduleMap);

  const actual: Record<string, ActualAttendance> = {};
  for (const r of att.rows) {
    actual[r.student_id] = {
      firstInMin: r.first_in_at ? minuteOfKST(r.first_in_at) : null,
      lastOutMin: r.kind === "out" ? minuteOfKST(r.at) : null,
    };
  }

  const nowMin = minuteOfKST(new Date().toISOString());

  return {
    rooms: rooms.rows, seats: seats.rows, students: students.rows, occupancy,
    canAttend: can(me, "attendance.edit"), scheduleMap, periods, actual, nowMin,
  };
}
