import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { weekStartLabel, PENALTY_BY_KEY } from "@/lib/penalty";
import { weekStartKey, todayKey } from "@/lib/date";
import { PATROL_BY_KEY } from "@/lib/patrol";
import PenaltyView, { type PRoom, type PSeat, type PStudent, type Breakdown } from "./PenaltyView";

export const runtime = "nodejs";

export default async function PenaltyPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "penalty.view")) redirect("/home");
  await ready();
  const canManage = can(me, "penalty.manage");
  const branch = me.activeBranchId;
  const ws = weekStartKey(new Date());

  const [rooms, seats, students, patSum, manSum, patBreak, manBreak] = await Promise.all([
    db.query<PRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<PSeat>(`select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`, [branch]),
    db.query<PStudent>(
      `select s.id, s.name, s.level, s.grade, s.is_repeat, seat.number as seat_number
         from student s left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.branch_id=$1 and s.status='enrolled' order by s.name`,
      [branch],
    ),
    // 집계는 재원생만 → 대시보드 합계가 목록/좌석뷰(재원생)와 정확히 일치
    db.query<{ student_id: string; pts: number }>(
      `select pe.student_id, sum(pe.points)::int as pts from patrol_event pe
         join student s on s.id=pe.student_id and s.status='enrolled'
        where pe.branch_id=$1 and pe.date>=$2 and pe.points<>0 group by pe.student_id`,
      [branch, ws],
    ),
    db.query<{ student_id: string; pts: number }>(
      `select pn.student_id, sum(pn.points)::int as pts from penalty_event pn
         join student s on s.id=pn.student_id and s.status='enrolled'
        where pn.branch_id=$1 and pn.date>=$2 group by pn.student_id`,
      [branch, ws],
    ),
    db.query<{ state: string; pts: number; cnt: number }>(
      `select pe.state, sum(pe.points)::int as pts, count(*)::int as cnt from patrol_event pe
         join student s on s.id=pe.student_id and s.status='enrolled'
        where pe.branch_id=$1 and pe.date>=$2 and pe.points>0 group by pe.state`,
      [branch, ws],
    ),
    db.query<{ reason: string; pts: number; cnt: number }>(
      `select pn.reason, sum(pn.points)::int as pts, count(*)::int as cnt from penalty_event pn
         join student s on s.id=pn.student_id and s.status='enrolled'
        where pn.branch_id=$1 and pn.date>=$2 group by pn.reason`,
      [branch, ws],
    ),
  ]);

  // 학생별 이번 주 누적 = 순찰 + 수동
  const weekly: Record<string, number> = {};
  for (const r of patSum.rows) weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;
  for (const r of manSum.rows) weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;

  // 사유별 분포(순찰 상태 + 수동 사유)
  const breakdown: Breakdown[] = [
    ...patBreak.rows.map((r) => ({ label: `순찰 · ${PATROL_BY_KEY[r.state]?.label ?? r.state}`, points: r.pts, count: r.cnt })),
    ...manBreak.rows.map((r) => ({ label: PENALTY_BY_KEY[r.reason]?.label ?? r.reason, points: r.pts, count: r.cnt })),
  ].filter((b) => b.points > 0).sort((a, b) => b.points - a.points);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", flex: "none" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/m/seat" className="chip" style={{ textDecoration: "none" }}>‹ 좌석</Link>
            <span style={{ fontWeight: 700 }}>벌점</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>이번 주 {weekStartLabel(ws)} ~ · 월요일 리셋</div>
        </div>
      </header>

      <PenaltyView
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        weekly={weekly}
        breakdown={breakdown}
        weekLabel={weekStartLabel(ws)}
        weekStart={ws}
        today={todayKey()}
        canManage={canManage}
      />
    </main>
  );
}
