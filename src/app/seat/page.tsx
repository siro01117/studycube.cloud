import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, weekdayOf, minuteOfKST } from "@/lib/date";
import { buildOccupancy, type SeatOcc } from "@/lib/occupancy";
import type { DaySlot, Period, ActualAttendance } from "@/lib/schedule";
import MobileSeat, { type SRoom, type SSeat, type SStudent, type SScheduleInfo } from "./MobileSeat";

export const runtime = "nodejs";

// 캔버스 자체 핀치와 브라우저 확대가 싸우지 않게 이 화면만 잠근다(전역 설정은 그대로).
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// 폰용 좌석 배치도 — 풀스크린. 편집·툴바는 데스크톱(/m/seat)에 그대로 둔다.
export default async function MobileSeatPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "seat.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;

  const today = todayKey();
  // 오늘 요일 — KST 날짜 문자열에서 산출(무인자 new Date() 금지). schedule_rule.days / schedule_hours.day
  // 는 1=월..7=일 좌표계 — JS getUTCDay()(0=일..6=토)에서 변환한다. (m/seat/page.tsx 와 동일 로직)
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
    // 오늘 학생별 마지막 출결 이벤트 — at/auto/note 도 함께(순찰 기록과 시각 비교 + title 표시용).
    // first_in_at: 오늘 그 학생의 첫 "입실" 이벤트 시각 — window 함수라 distinct on 이 마지막 행을 고르기
    // 전에 계산되므로(윈도우 함수는 distinct on 보다 먼저 실행) 1회 왕복으로 같이 얻을 수 있다.
    db.query<{ student_id: string; kind: string; at: string; auto: boolean; note: string | null; first_in_at: string | null }>(
      `select distinct on (student_id) student_id, kind, at::text as at, auto, note,
              (min(at) filter (where kind='in') over (partition by student_id))::text as first_in_at
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    // 오늘 학생별 마지막 순찰 기록 — 지점 전체 1쿼리(학생별 루프 없음).
    db.query<{ student_id: string; state: string; at: string }>(
      `select distinct on (student_id) student_id, state, at::text as at
         from patrol_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    // 스케쥴 고스트/퇴실 확인창 분류 소스 3쿼리 — 학생 수만큼 루프 쿼리하지 않고 지점 전체를 한 번에
    // 읽어 memory join 한다(m/seat/page.tsx 와 동일 패턴).
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

  // 오늘 재실/부재 최종 판정 — 학생별 마지막 순찰 기록과 마지막 출결 기록 중 시각이 더 늦은 쪽(동시각이면
  // 출결)을 따른다(src/lib/occupancy.ts, /m/seat 화면과 동일 규칙 공유).
  const occupancy: Record<string, SeatOcc> = buildOccupancy(att.rows, pat.rows);

  // 학생별 오늘 실제 출결 요약(statusAt 5번째 인자) — att.rows 를 재사용(별도 쿼리 없음).
  const actual: Record<string, ActualAttendance> = {};
  for (const r of att.rows) {
    actual[r.student_id] = {
      firstInMin: r.first_in_at ? minuteOfKST(r.first_in_at) : null,
      lastOutMin: r.kind === "out" ? minuteOfKST(r.at) : null,
    };
  }

  // studentId → { hours, slots[] } — 오늘 예외가 skip_rule_id 로 대체를 지시한 정기 일정은 제외 처리한다.
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

  return (
    <MobileSeat
      rooms={rooms.rows}
      seats={seats.rows}
      students={students.rows}
      occupancy={occupancy}
      canAttend={can(me, "attendance.edit")}
      scheduleMap={scheduleMap}
      periods={periods}
      actual={actual}
    />
  );
}
