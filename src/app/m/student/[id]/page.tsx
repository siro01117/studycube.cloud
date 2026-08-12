import { notFound, redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, addDays, weekStartKey } from "@/lib/date";
import { STU_STATUS } from "../util";
import {
  RECENT_DAYS, hoursByDayOf, buildAttendanceDays, summarizeAttendance, buildAttendanceCalendar,
  patrolStateCounts, buildPatrolCalendar,
  summarizePenalty, combinePointEvents, buildPenaltyWeekSummary, buildPenaltyHourly,
  buildPenaltyReasonBars, buildScheduleMiniature, buildReliabilityFlags, reliabilityTooltip,
  type PatrolRow, type PenaltyRow, type RuleRow, type ExceptionRow, type AttendanceEventRow,
} from "./util";
import StudentDetail from "./StudentDetail";

export const runtime = "nodejs";

type StudentRow = {
  id: string; name: string; status: string; level: string | null; grade: string | null;
  is_repeat: boolean | null; school: string | null; seat_number: number | null;
};

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "student.view")) redirect("/home");
  await ready();
  const { id } = await params;

  const today = todayKey();
  // 최근 30일(오늘 포함) 시작일 — KST 자정 기준. 순찰·벌점 쿼리 하한으로 쓴다.
  const cutoffDate = addDays(today, -(RECENT_DAYS - 1));
  const cutoffTs = `${cutoffDate}T00:00:00+09:00`;
  // 이번 주(월~일) — 스케쥴 미니어처의 임시 일정(schedule_exception) 조회 범위. weekStartKey 는 Date 를
  // 받으므로 "정오 UTC"로 만든 날짜만 넘긴다(서버 UTC 와 KST 날짜가 어긋나는 걸 방지, util.ts 와 동일 관례).
  const thisWeekStart = weekStartKey(new Date(`${today}T12:00:00Z`));
  const thisWeekEnd = addDays(thisWeekStart, 6);

  const [studentRows, hoursRows, attRows, patrolRows, penaltyRows, ruleRows, exceptionRows] = await Promise.all([
    // 학생 1명 — branch_id 도 함께 걸어 다른 지점 학생 id 로 접근 못 하게 막는다(멀티테넌트).
    db.query<StudentRow>(
      `select s.id, s.name, s.status, s.level, s.grade, s.is_repeat, s.school,
              seat.number as seat_number
         from student s
         left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.id = $1 and s.branch_id = $2`,
      [id, me.activeBranchId],
    ),
    db.query<{ day: number; arrive_min: number; leave_min: number }>(
      `select day, arrive_min, leave_min from schedule_hours where branch_id=$1 and student_id=$2 order by day`,
      [me.activeBranchId, id],
    ),
    // A. 출결 — 원본 이벤트를 그대로 가져온다(day 단위 집계는 util.ts 의 groupBySessionDay 가 JS 에서 재현).
    // 히트맵(재실 구간)엔 이벤트별 시각이 필요해 집계 쿼리 대신 이걸 쓰고, "세션일"(06:00~익일06:00, KST)
    // 묶음·자정 넘김 하원(예: 익일 01:00 퇴실) 처리도 util.ts 로 옮겼다 — 쿼리 수는 그대로 1개.
    db.query<AttendanceEventRow>(
      `select at::text as at, kind, note
         from attendance_event
        where student_id=$1 and branch_id=$2 and at >= $3::timestamptz
        order by at asc`,
      [id, me.activeBranchId, cutoffTs],
    ),
    // B. 순찰 — 목록 표시분 + 시간대 히스토그램용 hour(KST) 를 SQL 에서 함께 뽑아 클라 날짜 파싱을 없앤다.
    db.query<PatrolRow>(
      `select date::text as date, at::text as at, state, points, note,
              extract(hour from at at time zone 'Asia/Seoul')::int as hour
         from patrol_event
        where student_id=$1 and branch_id=$2 and at >= $3::timestamptz
        order by at desc`,
      [id, me.activeBranchId, cutoffTs],
    ),
    // C. 벌점
    db.query<PenaltyRow>(
      `select date::text as date, at::text as at, reason, points, note
         from penalty_event
        where student_id=$1 and branch_id=$2 and at >= $3::timestamptz
        order by at desc`,
      [id, me.activeBranchId, cutoffTs],
    ),
    // D. 정기 일정
    db.query<RuleRow>(
      `select id, reason, kind, title, start_min, end_min, days
         from schedule_rule where branch_id=$1 and student_id=$2 order by start_min`,
      [me.activeBranchId, id],
    ),
    // D-2. 이번 주 임시 일정(schedule_exception) — 스케쥴 미니어처 전용, 이번 주 범위만(쿼리 수 +1, 보고에 명시).
    db.query<ExceptionRow>(
      `select id, reason, title, start_min, end_min, date::text as date, skip_rule_id
         from schedule_exception
        where branch_id=$1 and student_id=$2 and date between $3 and $4`,
      [me.activeBranchId, id, thisWeekStart, thisWeekEnd],
    ),
  ]);

  const student = studentRows.rows[0];
  if (!student) notFound();

  const hoursByDay = hoursByDayOf(hoursRows.rows);
  const hasSchedule = hoursRows.rows.length > 0;

  const attendanceDays = buildAttendanceDays(attRows.rows, hoursByDay, today);
  const attendanceSummary = summarizeAttendance(attendanceDays, hasSchedule);
  // attendanceDays(attRows 1회 쿼리 결과를 이미 세션일별로 집계한 값)를 그대로 재사용 — 추가 쿼리 없음.
  const attendanceHeatmap = buildAttendanceCalendar(attendanceDays, hoursByDay, today);

  const patrolCounts = patrolStateCounts(patrolRows.rows);
  // patrolRows(이미 쿼리된 원본)를 재사용 — 추가 쿼리 없음.
  const patrolHeatmap = buildPatrolCalendar(patrolRows.rows, today);

  // total30(최근 30일 누적)은 "구성" 카드 제목의 title 툴팁에만 쓴다 — 화면 표시는 이번 주 벌점(penaltyWeek) 기준.
  const penaltySummary = summarizePenalty(penaltyRows.rows, today);
  // 벌점 카드(주간 운영) — 순찰(points>0)+수동을 합친 이벤트 축. patrolRows/penaltyRows(이미 쿼리된 원본)를
  // 재사용 — 추가 쿼리 없음.
  const penaltyEvents = combinePointEvents(patrolRows.rows, penaltyRows.rows);
  const penaltyWeek = buildPenaltyWeekSummary(penaltyEvents, today);
  const penaltyHourly = buildPenaltyHourly(penaltyEvents, today);
  const penaltyReasonBars = buildPenaltyReasonBars(penaltyEvents);

  const scheduleMiniature = buildScheduleMiniature(ruleRows.rows, exceptionRows.rows, hoursByDay, today);

  // 통계 신뢰도 배지 — attendanceDays(이미 계산됨)·patrolRows.rows(이미 쿼리됨)만 재사용, 새 쿼리 없음.
  // title 툴팁 문자열까지 여기서 완성해 내려준다(StudentDetail.tsx 는 표현만 — 이 화면의 다른 값들과
  // 같은 원칙). null 이면 그 카드는 깨끗함(배지 자체를 그리지 않음).
  const reliabilityFlags = buildReliabilityFlags(attendanceDays, patrolRows.rows, hasSchedule);
  const reliability = {
    attendance: reliabilityTooltip(reliabilityFlags.attendance),
    late: reliabilityTooltip(reliabilityFlags.late),
    patrol: reliabilityTooltip(reliabilityFlags.patrol),
  };

  const seatLabel = student.seat_number != null ? `${student.seat_number}번` : "미배정";
  const statusLabel = STU_STATUS[student.status] ?? student.status;
  const canEditSchedule = can(me, "schedule.view");

  return (
    <main style={{ minHeight: "100dvh" }}>
      <div className="mx-auto" style={{ maxWidth: 1400, padding: "14px 18px" }}>
        <StudentDetail
          student={{ id: student.id, name: student.name, seatLabel, statusLabel, isLeave: student.status === "leave" }}
          attendanceDays={attendanceDays}
          attendanceSummary={attendanceSummary}
          attendanceHeatmap={attendanceHeatmap}
          patrolCounts={patrolCounts}
          patrolHeatmap={patrolHeatmap}
          patrolTotal={patrolRows.rows.length}
          penaltyWeek={penaltyWeek}
          penaltyHourly={penaltyHourly}
          penaltyReasonBars={penaltyReasonBars}
          penaltyTotal30={penaltySummary.total30}
          scheduleMiniature={scheduleMiniature}
          ruleCount={ruleRows.rows.length}
          hasSchedule={hasSchedule}
          canEditSchedule={canEditSchedule}
          reliability={reliability}
        />
      </div>
    </main>
  );
}
