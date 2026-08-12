import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import FloorEditor, { type Room, type Seat, type Student, type ScheduleInfo } from "./FloorEditor";
import PhoneRedirect from "../_shared/PhoneRedirect";
import { todayKey as todayStr, weekdayOf, minuteOfKST } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)
import type { DaySlot, Period, ActualAttendance } from "@/lib/schedule";
import { getOpenPatrolSession } from "./patrolActions";
import { buildOccupancy, type SeatOcc } from "@/lib/occupancy";

export const runtime = "nodejs";

export default async function SeatPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "seat.view")) redirect("/home");
  await ready();
  const canManage = can(me, "seat.manage");
  const canEditStudent = can(me, "student.edit");
  const canAttend = can(me, "attendance.edit");
  const canPatrol = can(me, "patrol.manage");
  const canPatrolView = can(me, "patrol.view");
  const branch = me.activeBranchId;
  const sp = await searchParams;

  // 오늘 요일 — KST 날짜 문자열에서 산출(무인자 new Date() 금지). schedule_rule.days / schedule_hours.day
  // 는 1=월..7=일 좌표계 — JS getUTCDay()(0=일..6=토)에서 변환한다. (모바일 순찰 page.tsx 와 동일 로직)
  const today = todayStr();
  const jsDow = weekdayOf(today);
  const dbDay = jsDow === 0 ? 7 : jsDow;

  const [rooms, students, seats, br, att, pat, lastPat, openSession, hoursRows, ruleRows, excRows, periodRows] = await Promise.all([
    db.query<Room>(
      `select id, name, floor, cols, rows, pos_x, pos_y, door_side from room where branch_id=$1 order by floor, name`,
      [branch],
    ),
    db.query<Student>(
      `select id, name, grade, school, status, guardian_phone, student_phone, level, is_repeat,
              birthdate::text as birthdate, gender, enrolled_at::text as enrolled_at
         from student where branch_id=$1 order by name`,
      [branch],
    ),
    db.query<Seat>(
      `select id, room_id, grid_x, grid_y, number, label, seat_type, facing, status, current_student_id
         from seat where branch_id=$1`,
      [branch],
    ),
    db.query<{ name: string }>(`select name from branch where id=$1`, [branch]),
    // 오늘 학생별 마지막 출결 이벤트 — at/auto/note 도 함께 가져온다(순찰 기록과 시각 비교 + title 표시용).
    // first_in_at: 오늘 그 학생의 첫 "입실" 이벤트 시각 — window 함수라 distinct on 이 마지막 행을 고르기
    // 전에 계산되므로(윈도우 함수는 distinct on 보다 먼저 실행) 1회 왕복으로 같이 얻을 수 있다.
    db.query<{ student_id: string; kind: string; at: string; auto: boolean; note: string | null; first_in_at: string | null }>(
      `select distinct on (student_id) student_id, kind, at::text as at, auto, note,
              (min(at) filter (where kind='in') over (partition by student_id))::text as first_in_at
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, todayStr()],
    ),
    // 오늘 순찰: 최신 상태·시각 + 점수합을 한 번의 스캔으로(같은 테이블 두 번 읽지 않음, 학생별 루프 없음).
    // at 은 좌석 배치도 재실/부재 판정에서 출결 기록과 시각을 비교하는 데 쓴다(buildOccupancy).
    db.query<{ student_id: string; state: string | null; at: string | null; points: number }>(
      `select student_id,
              (array_agg(state order by at desc))[1] as state,
              (array_agg(at order by at desc))[1]::text as at,
              sum(points)::int as points
         from patrol_event where branch_id=$1 and date=$2
         group by student_id`,
      [branch, todayStr()],
    ),
    db.query<{ last: string | null }>(
      `select max(started_at)::text as last from patrol_session where branch_id=$1`,
      [branch],
    ),
    // 미종료 순찰 세션 — 있으면 "순찰 시작" 대신 "이어하기"(액션 내부에서 12h 초과분은 자동 종료).
    // getOpenPatrolSession 은 patrol.view 를 guard() 하므로 그 권한이 없는 사용자는 호출 자체를 건너뛴다
    // (그렇지 않으면 seat.view 만 있는 사용자가 이 페이지에서 예외로 터진다).
    canPatrolView ? getOpenPatrolSession() : Promise.resolve(null),
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

  const branchName = br.rows[0]?.name ?? "";

  // studentId → { hours, slots[] } — 오늘 예외가 skip_rule_id 로 대체를 지시한 정기 일정은 제외 처리한다.
  // buildOccupancy(퇴실 사유의 스케쥴 추정)가 이 scheduleMap 을 그대로 재사용하므로 occupancy 계산보다 먼저 만든다.
  const skippedRuleIds = new Set(excRows.rows.filter((e) => e.skip_rule_id).map((e) => e.skip_rule_id as string));
  const scheduleMap: Record<string, ScheduleInfo> = {};
  const ensureSchedule = (sid: string): ScheduleInfo =>
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

  // 오늘 재실/부재 최종 판정 — 학생별 마지막 순찰 기록과 마지막 출결 기록 중 시각이 더 늦은 쪽(동시각이면
  // 출결)을 따른다(src/lib/occupancy.ts, /seat 화면과 동일 규칙 공유). 퇴실 사유 스케쥴 추정도 scheduleMap
  // 을 그대로 넘겨 계산한다(새 쿼리 없음).
  const occupancy: Record<string, SeatOcc> = buildOccupancy(att.rows, pat.rows, scheduleMap);
  // 학생별 오늘 실제 출결 요약(statusAt 의 5번째 인자) — 스케쥴보다 일찍 입실했는데 계속 "등원전"으로
  // 뜨는 오판을 막는다. att.rows 를 재사용(별도 쿼리 없음).
  const actual: Record<string, ActualAttendance> = {};
  for (const r of att.rows) {
    actual[r.student_id] = {
      firstInMin: r.first_in_at ? minuteOfKST(r.first_in_at) : null,
      lastOutMin: r.kind === "out" ? minuteOfKST(r.at) : null,
    };
  }
  const initialRoomId =
    (sp.room && rooms.rows.some((r) => r.id === sp.room) ? sp.room : rooms.rows[0]?.id) ?? null;

  // 지금 KST 분(자정부터 경과) — 좌석 배치도 "확인 필요" 판정(occupancy.needsAttentionCheck)에 쓴다.
  // 서버에서만 계산해 내려준다(클라 렌더에서 new Date() 호출 금지 원칙).
  const nowMin = minuteOfKST(new Date().toISOString());

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PhoneRedirect to="/seat" />
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/home" className="chip" style={{ textDecoration: "none" }}>‹ 홈</Link>
            <span style={{ fontWeight: 700 }}>좌석 배치도</span>
            {branchName && <span className="chip">{branchName}</span>}
          </div>
          <div className="flex items-center gap-3">
            {canPatrol && <Link href="/patrol" className="chip mobile-only" style={{ textDecoration: "none", color: "var(--accent)", fontWeight: 700 }}>순찰 시작 →</Link>}
            <span className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>{rooms.rows.length}개 방 · 좌석 {seats.rows.length}</span>
          </div>
        </div>
      </header>

      <FloorEditor
        key={initialRoomId ?? "none"}
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        canManage={canManage}
        canEditStudent={canEditStudent}
        initialRoomId={initialRoomId}
        occupancy={occupancy}
        canAttend={canAttend}
        canPatrol={canPatrol}
        lastPatrolAt={lastPat.rows[0]?.last ?? null}
        openSession={openSession}
        scheduleMap={scheduleMap}
        periods={periods}
        actual={actual}
        serverNowMin={nowMin}
      />
    </main>
  );
}
