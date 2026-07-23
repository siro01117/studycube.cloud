import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import FloorEditor, { type Room, type Seat, type Student, type AttInfo, type PatrolInfo } from "./FloorEditor";
import { todayKey as todayStr } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)

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
  const branch = me.activeBranchId;
  const sp = await searchParams;

  const [rooms, students, seats, br, att, patState, patPts, lastPat] = await Promise.all([
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
    db.query<{ student_id: string; state: string }>(
      `select distinct on (student_id) student_id, state
         from patrol_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, todayStr()],
    ),
    db.query<{ student_id: string; points: number }>(
      `select student_id, sum(points)::int as points
         from patrol_event where branch_id=$1 and date=$2
         group by student_id`,
      [branch, todayStr()],
    ),
    db.query<{ last: string | null }>(
      `select max(started_at)::text as last from patrol_session where branch_id=$1`,
      [branch],
    ),
  ]);

  const branchName = br.rows[0]?.name ?? "";
  const attendance: Record<string, AttInfo> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";
  const patrol: Record<string, PatrolInfo> = {};
  for (const r of patState.rows) patrol[r.student_id] = { state: r.state, points: 0 };
  for (const r of patPts.rows) patrol[r.student_id] = { state: patrol[r.student_id]?.state ?? "", points: r.points };
  const initialRoomId =
    (sp.room && rooms.rows.some((r) => r.id === sp.room) ? sp.room : rooms.rows[0]?.id) ?? null;

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/home" className="chip" style={{ textDecoration: "none" }}>‹ 홈</Link>
            <span style={{ fontWeight: 700 }}>좌석 배치도</span>
            {branchName && <span className="chip">{branchName}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>{rooms.rows.length}개 방 · 좌석 {seats.rows.length}</div>
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
      />
    </main>
  );
}
