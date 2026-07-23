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
  const canPatrolManage = can(me, "patrol.manage"); // 순찰 벌점 행 삭제는 patrol.manage 필요
  const branch = me.activeBranchId;
  const ws = weekStartKey(new Date());
  const wsLabel = weekStartLabel(ws); // 한 번만 계산

  // 집계는 재원생만 → 대시보드 합계가 목록/좌석뷰(재원생)와 정확히 일치.
  // 순찰·수동 각각 (학생×상태/사유) 한 번의 스캔으로 학생별 합계와 분포를 동시에 산출(테이블 4회→2회 스캔).
  const [rooms, seats, students, patRows, manRows] = await Promise.all([
    db.query<PRoom>(`select id, name, floor from room where branch_id=$1 order by floor, name`, [branch]),
    db.query<PSeat>(`select id, room_id, grid_x, grid_y, number, label, current_student_id from seat where branch_id=$1`, [branch]),
    db.query<PStudent>(
      `select s.id, s.name, s.level, s.grade, s.is_repeat, seat.number as seat_number
         from student s left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.branch_id=$1 and s.status='enrolled' order by s.name`,
      [branch],
    ),
    db.query<{ student_id: string; state: string; pts: number; cnt: number }>(
      `select pe.student_id, pe.state, sum(pe.points)::int as pts, count(*)::int as cnt from patrol_event pe
         join student s on s.id=pe.student_id and s.status='enrolled'
        where pe.branch_id=$1 and pe.date>=$2 and pe.points<>0 group by pe.student_id, pe.state`,
      [branch, ws],
    ),
    db.query<{ student_id: string; reason: string; pts: number; cnt: number }>(
      `select pn.student_id, pn.reason, sum(pn.points)::int as pts, count(*)::int as cnt from penalty_event pn
         join student s on s.id=pn.student_id and s.status='enrolled'
        where pn.branch_id=$1 and pn.date>=$2 group by pn.student_id, pn.reason`,
      [branch, ws],
    ),
  ]);

  // 학생별 이번 주 누적 + 사유별 분포를 각 결과셋 1패스로 동시 집계.
  const weekly: Record<string, number> = {};
  const patByState = new Map<string, { pts: number; cnt: number }>();
  for (const r of patRows.rows) {
    weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;
    const c = patByState.get(r.state) ?? { pts: 0, cnt: 0 };
    c.pts += r.pts; c.cnt += r.cnt; patByState.set(r.state, c);
  }
  const manByReason = new Map<string, { pts: number; cnt: number }>();
  for (const r of manRows.rows) {
    weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;
    const c = manByReason.get(r.reason) ?? { pts: 0, cnt: 0 };
    c.pts += r.pts; c.cnt += r.cnt; manByReason.set(r.reason, c);
  }

  const breakdown: Breakdown[] = [
    ...[...patByState].map(([state, v]) => ({ label: `순찰 · ${PATROL_BY_KEY[state]?.label ?? state}`, points: v.pts, count: v.cnt })),
    ...[...manByReason].map(([reason, v]) => ({ label: PENALTY_BY_KEY[reason]?.label ?? reason, points: v.pts, count: v.cnt })),
  ].filter((b) => b.points > 0).sort((a, b) => b.points - a.points);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", flex: "none" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/m/seat" className="chip" style={{ textDecoration: "none" }}>‹ 좌석</Link>
            <span style={{ fontWeight: 700 }}>벌점</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>이번 주 {wsLabel} ~ · 월요일 리셋</div>
        </div>
      </header>

      <PenaltyView
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        weekly={weekly}
        breakdown={breakdown}
        weekLabel={wsLabel}
        weekStart={ws}
        today={todayKey()}
        canManage={canManage}
        canPatrolManage={canPatrolManage}
      />
    </main>
  );
}
