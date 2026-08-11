import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import FloorEditor, { type Room, type Seat, type Student, type AttInfo, type PatrolInfo, type ScheduleInfo } from "./FloorEditor";
import PhoneRedirect from "../_shared/PhoneRedirect";
import { todayKey as todayStr, weekdayOf, timeLabel } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)
import type { DaySlot } from "@/lib/schedule";
import { getOpenPatrolSession } from "./patrolActions";
import { PATROL_BY_KEY } from "@/lib/patrol";

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

  const [rooms, students, seats, br, att, pat, lastPat, openSession, hoursRows, ruleRows, excRows] = await Promise.all([
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
    db.query<{ student_id: string; kind: string }>(
      `select distinct on (student_id) student_id, kind
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, todayStr()],
    ),
    // 오늘 순찰: 최신 상태·시각 + 점수합을 한 번의 스캔으로(같은 테이블 두 번 읽지 않음, 학생별 루프 없음).
    // at 은 평상시 좌석 배치도의 재실/부재 title("순찰 20:12 · 자리비움")에 쓴다.
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
  ]);

  const branchName = br.rows[0]?.name ?? "";
  const attendance: Record<string, AttInfo> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";
  // 오늘 마지막 순찰 기록 — 좌석 배치도 평상시 재실/부재 표시가 attendance 보다 이걸 우선한다(없으면 폴백).
  const patrol: Record<string, PatrolInfo> = {};
  for (const r of pat.rows) {
    const cfg = r.state ? PATROL_BY_KEY[r.state] : undefined;
    const asIn = cfg?.asIn ?? true;
    patrol[r.student_id] = {
      state: r.state ?? "",
      points: r.points,
      asIn,
      atLabel: r.at ? `순찰 ${timeLabel(r.at)} · ${cfg?.label ?? r.state} · ${asIn ? "입실 간주" : "퇴실 간주"}` : "",
    };
  }
  const initialRoomId =
    (sp.room && rooms.rows.some((r) => r.id === sp.room) ? sp.room : rooms.rows[0]?.id) ?? null;

  // studentId → { hours, slots[] } — 오늘 예외가 skip_rule_id 로 대체를 지시한 정기 일정은 제외 처리한다.
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
        attendance={attendance}
        canAttend={canAttend}
        patrol={patrol}
        canPatrol={canPatrol}
        lastPatrolAt={lastPat.rows[0]?.last ?? null}
        openSession={openSession}
        scheduleMap={scheduleMap}
      />
    </main>
  );
}
