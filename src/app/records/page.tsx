import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/date";
import { getPatrolSessions } from "../m/seat/patrolActions";
import MobileRecords, { type RRoom, type RSeat } from "./MobileRecords";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 폰용 순찰 기록 — 세션별 학생 상태를 리스트로. 데스크톱(/m/patrol)은 그대로.
export default async function MobileRecordsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();

  const branch = me.activeBranchId;
  const [raw, rooms, seats] = await Promise.all([
    getPatrolSessions(),
    db.query<RRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<RSeat>(
      `select id, room_id, grid_x, grid_y, number, label from seat where branch_id=$1`,
      [branch],
    ),
  ]);

  // 표시 문자열은 서버에서 만든다. 클라에서 toLocale*/new Date 를 쓰면
  // 서버(UTC·en 로케일)와 브라우저(KST·ko)가 달라 하이드레이션이 깨진다.
  // started_at 은 '2026-08-04 07:49:28.559+09' 형태(이미 KST) → 문자열에서 직접 자른다.
  const today = todayKey();
  const sessions = raw.map((s) => {
    const day = s.started_at.slice(0, 10);
    const time = s.started_at.slice(11, 16);
    const [, m, d] = day.split("-");
    return {
      id: s.id,
      dayLabel: day === today ? "오늘" : `${Number(m)}월 ${Number(d)}일`,
      timeLabel: time,
      durLabel: durOf(s.started_at, s.ended_at),
      marked: s.marked,
      penalty: s.penalty,
    };
  });

  return (
    <MobileRecords
      sessions={sessions}
      rooms={rooms.rows}
      seats={seats.rows}
      canManage={can(me, "patrol.manage")}
    />
  );
}

function durOf(a: string, b: string | null): string {
  if (!b) return "진행 중";
  const sec = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}분` : `${sec}초`;
}
