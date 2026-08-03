import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/date";
import MobilePatrol, { type MRoom, type MSeat, type MStudent } from "./MobilePatrol";

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

  const [rooms, seats, students, att] = await Promise.all([
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
      [branch, todayKey()],
    ),
  ]);

  const attendance: Record<string, "in" | "out"> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";

  return (
    <MobilePatrol
      rooms={rooms.rows}
      seats={seats.rows}
      students={students.rows}
      attendance={attendance}
      canManage={can(me, "patrol.manage")}
      branchKey={branch ?? "nobranch"}
    />
  );
}
