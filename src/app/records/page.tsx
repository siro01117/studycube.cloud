import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, dayLabel } from "@/lib/date";
import { getPatrolSessions, getPatrolDates } from "../m/seat/patrolActions";
import MobileRecords, { type RRoom, type RSeat } from "./MobileRecords";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 폰용 순찰 기록 — 세션별 학생 상태를 리스트로. 데스크톱(/m/patrol)은 그대로.
export default async function MobileRecordsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();

  const branch = me.activeBranchId;
  const today = todayKey();
  const sp = await searchParams;
  // 미래 날짜·잘못된 형식은 오늘로 되돌림(주소창 조작 대비)
  const date = sp.date && DATE_RE.test(sp.date) && sp.date <= today ? sp.date : today;

  const [raw, rooms, seats, dates] = await Promise.all([
    getPatrolSessions(date),
    db.query<RRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<RSeat>(
      `select id, room_id, grid_x, grid_y, number, label from seat where branch_id=$1`,
      [branch],
    ),
    getPatrolDates(),
  ]);

  // 표시 문자열은 서버에서 만든다. 클라에서 toLocale*/new Date 를 쓰면
  // 서버(UTC·en 로케일)와 브라우저(KST·ko)가 달라 하이드레이션이 깨진다.
  // started_at 은 '2026-08-04 07:49:28.559+09' 형태(이미 KST) → 문자열에서 직접 자른다.
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
      date={date}
      dateLabel={dayLabel(date, today)}
      prevDate={prevRecordDate(dates, date)}
      nextDate={nextRecordDate(dates, date)}
      hasRecord={dates.includes(date)}
    />
  );
}

function durOf(a: string, b: string | null): string {
  if (!b) return "진행 중";
  const sec = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}분` : `${sec}초`;
}

// 이전/다음 이동이 빈 날을 건너뛰고 "기록 있는 날"로만 점프하도록 — getPatrolDates() 가 이미 내려준
// 목록(dates)만 쓴다(추가 쿼리 없음). dates 는 최근 180일 내 기록 있는 날짜(문자열 정렬 가능한
// "YYYY-MM-DD")이므로 문자열 비교만으로 순서를 매길 수 있다.
function prevRecordDate(dates: string[], date: string): string | null {
  let result: string | null = null;
  for (const d of dates) {
    if (d < date && (result === null || d > result)) result = d;
  }
  return result;
}

function nextRecordDate(dates: string[], date: string): string | null {
  let result: string | null = null;
  for (const d of dates) {
    if (d > date && (result === null || d < result)) result = d;
  }
  return result;
}
