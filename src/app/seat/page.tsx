import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, timeLabel } from "@/lib/date";
import { PATROL_BY_KEY } from "@/lib/patrol";
import MobileSeat, { type SRoom, type SSeat, type SStudent, type Att, type LastPatrol } from "./MobileSeat";

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
  const [rooms, seats, students, att, pat] = await Promise.all([
    db.query<SRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<SSeat>(
      `select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`,
      [branch],
    ),
    db.query<SStudent>(
      `select id, name, grade, school, student_phone, guardian_phone from student where branch_id=$1`,
      [branch],
    ),
    db.query<{ student_id: string; kind: string }>(
      `select distinct on (student_id) student_id, kind
         from attendance_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
    // 오늘 학생별 마지막 순찰 기록 — 지점 전체 1쿼리(학생별 루프 없음). 좌석 재실/부재 표시가
    // attendance 보다 이걸 우선한다(없으면 attendance 폴백, MobileSeat.tsx 참고).
    db.query<{ student_id: string; state: string; at: string }>(
      `select distinct on (student_id) student_id, state, at::text as at
         from patrol_event where branch_id=$1 and date=$2
         order by student_id, at desc`,
      [branch, today],
    ),
  ]);

  const attendance: Record<string, Att> = {};
  for (const r of att.rows) attendance[r.student_id] = r.kind === "in" ? "in" : "out";
  const lastPatrol: Record<string, LastPatrol> = {};
  for (const r of pat.rows) {
    const cfg = PATROL_BY_KEY[r.state];
    const asIn = cfg?.asIn ?? true;
    lastPatrol[r.student_id] = { asIn, atLabel: `순찰 ${timeLabel(r.at)} · ${cfg?.label ?? r.state} · ${asIn ? "입실 간주" : "퇴실 간주"}` };
  }

  return (
    <MobileSeat
      rooms={rooms.rows}
      seats={seats.rows}
      students={students.rows}
      attendance={attendance}
      lastPatrol={lastPatrol}
      canAttend={can(me, "attendance.edit")}
    />
  );
}
