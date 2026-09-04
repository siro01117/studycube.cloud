import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import PhoneRedirect from "../_shared/PhoneRedirect";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { getPatrolSessions, getPatrolDates } from "../seat/patrolActions";
import { todayKey } from "@/lib/date";
import PatrolBoard, { type PSeat, type PRoom, type PStudent } from "./PatrolBoard";
import PageHeader from "../_shared/PageHeader";

export const runtime = "nodejs";

export default async function PatrolPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();
  const canManage = can(me, "patrol.manage");
  const canPenaltyView = can(me, "penalty.view"); // 벌점 현황 탭 노출 — 전용 모듈(/m/penalty) 제거 후 이 화면에 흡수됨
  const branch = me.activeBranchId;

  const [rooms, seats, students, sessions, dates] = await Promise.all([
    db.query<PRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<PSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<PStudent>(`select id, name from student where branch_id=$1`, [branch]),
    getPatrolSessions(), // 날짜 미지정 = 오늘(KST)
    getPatrolDates(),
  ]);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PhoneRedirect to="/records" />
      <PageHeader
        backHref="/m/seat"
        backLabel="좌석"
        title="순찰 기록"
        flexNone
        right={
          <div className="flex items-center gap-3">
            <Link href="/patrol" className="chip mobile-only" style={{ textDecoration: "none", color: "var(--accent)", fontWeight: 700 }}>순찰 시작 →</Link>
            <span className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>오늘 순찰 {sessions.length}회</span>
          </div>
        }
      />

      <PatrolBoard
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        sessions={sessions}
        dates={dates}
        today={todayKey()}
        canManage={canManage}
        canPenaltyView={canPenaltyView}
      />
    </main>
  );
}
