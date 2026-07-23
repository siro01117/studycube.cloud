import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { getPatrolSessions } from "../seat/patrolActions";
import { todayKey } from "@/lib/date";
import PatrolBoard, { type PSeat, type PRoom, type PStudent } from "./PatrolBoard";

export const runtime = "nodejs";

export default async function PatrolPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();
  const canManage = can(me, "patrol.manage");
  const branch = me.activeBranchId;

  const [rooms, seats, students, sessions] = await Promise.all([
    db.query<PRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<PSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<PStudent>(`select id, name from student where branch_id=$1`, [branch]),
    getPatrolSessions(),
  ]);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", flex: "none" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/m/seat" className="chip" style={{ textDecoration: "none" }}>‹ 좌석</Link>
            <span style={{ fontWeight: 700 }}>순찰 기록</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>순찰 {sessions.length}회</div>
        </div>
      </header>

      <PatrolBoard
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        sessions={sessions}
        today={todayKey()}
        canManage={canManage}
      />
    </main>
  );
}
