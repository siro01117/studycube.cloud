import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/date";
import { buildOccupancy, type SeatOcc } from "@/lib/occupancy";
import MobileSeat, { type SRoom, type SSeat, type SStudent } from "./MobileSeat";

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
    // 오늘 학생별 마지막 출결 이벤트 — at/auto 도 함께(순찰 기록과 시각 비교 + title 표시용).
    db.query<{ student_id: string; kind: string; at: string; auto: boolean }>(
      `select distinct on (student_id) student_id, kind, at::text as at, auto
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
  ]);

  // 오늘 재실/부재 최종 판정 — 학생별 마지막 순찰 기록과 마지막 출결 기록 중 시각이 더 늦은 쪽(동시각이면
  // 출결)을 따른다(src/lib/occupancy.ts, /m/seat 화면과 동일 규칙 공유).
  const occupancy: Record<string, SeatOcc> = buildOccupancy(att.rows, pat.rows);

  return (
    <MobileSeat
      rooms={rooms.rows}
      seats={seats.rows}
      students={students.rows}
      occupancy={occupancy}
      canAttend={can(me, "attendance.edit")}
    />
  );
}
