import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, dayLabel } from "@/lib/date";
import { getPatrolSessions, getPatrolDates } from "../m/seat/patrolActions";
import type { Session, RRoom, RSeat } from "./MobileRecords";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 터치 순찰 기록 화면(폰 /records, 태블릿 /t/records) 공용 데이터 로더.
export type RecordsProps = {
  sessions: Session[]; rooms: RRoom[]; seats: RSeat[]; canManage: boolean;
  date: string; dateLabel: string; prevDate: string | null; nextDate: string | null; hasRecord: boolean;
};

export async function loadRecordsData(rawDate: string | undefined): Promise<RecordsProps> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "patrol.view")) redirect("/home");
  await ready();

  const branch = me.activeBranchId;
  const today = todayKey();
  // 미래 날짜·잘못된 형식은 오늘로 되돌림(주소창 조작 대비)
  const date = rawDate && DATE_RE.test(rawDate) && rawDate <= today ? rawDate : today;

  const [raw, rooms, seats, dates] = await Promise.all([
    getPatrolSessions(date),
    db.query<RRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<RSeat>(
      `select id, room_id, grid_x, grid_y, number, label from seat where branch_id=$1`,
      [branch],
    ),
    getPatrolDates(),
  ]);

  const sessions: Session[] = raw.map((s) => {
    const day = s.started_kst.slice(0, 10);
    const time = s.started_kst.slice(11, 16);
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

  return {
    sessions, rooms: rooms.rows, seats: seats.rows, canManage: can(me, "patrol.manage"),
    date, dateLabel: dayLabel(date, today),
    prevDate: prevRecordDate(dates, date), nextDate: nextRecordDate(dates, date),
    hasRecord: dates.includes(date),
  };
}

function durOf(a: string, b: string | null): string {
  if (!b) return "진행 중";
  const sec = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}분` : `${sec}초`;
}

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
