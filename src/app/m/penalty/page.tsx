import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import PhoneRedirect from "../_shared/PhoneRedirect";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { weekStartLabel, PENALTY_BY_KEY } from "@/lib/penalty";
import { weekStartKey, addDays, todayKey } from "@/lib/date";
import { PATROL_BY_KEY } from "@/lib/patrol";
import PenaltyView, { type PRoom, type PSeat, type PStudent, type Breakdown } from "./PenaltyView";
import PageHeader from "../_shared/PageHeader";

export const runtime = "nodejs";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PenaltyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "penalty.view")) redirect("/home");
  await ready();
  const canManage = can(me, "penalty.manage");
  const canPatrolManage = can(me, "patrol.manage"); // 순찰 벌점 행 삭제는 patrol.manage 필요
  const branch = me.activeBranchId;

  // 조회할 주 — ?week=YYYY-MM-DD(월요일 아니어도 그 주의 월요일로 정규화). 미래 주는 이번 주로 클램프
  // (주소창 조작 대비 — records/page.tsx 의 date 클램프와 같은 패턴).
  const sp = await searchParams;
  const currentWeek = weekStartKey();
  const requested = sp.week && WEEK_RE.test(sp.week) ? weekStartKey(new Date(`${sp.week}T00:00:00Z`)) : currentWeek;
  const ws = requested > currentWeek ? currentWeek : requested;
  const isCurrentWeek = ws === currentWeek;
  const weekEnd = addDays(ws, 7); // 다음 주 월요일(배타적 상한) — 과거 주 조회 시 그 다음 주까지 안 섞이게
  const wsLabel = weekStartLabel(ws); // 한 번만 계산
  const prevWeek = addDays(ws, -7);
  const nextWeek = addDays(ws, 7);

  // 집계는 재원생만 → 대시보드 합계가 목록/좌석뷰(재원생)와 정확히 일치.
  // 순찰·수동 각각 (학생×상태/사유) 한 번의 스캔으로 학생별 합계와 분포를 동시에 산출(테이블 4회→2회 스캔).
  const [rooms, seats, students, patRows, manRows, patrolSessions] = await Promise.all([
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
        where pe.branch_id=$1 and pe.date>=$2 and pe.date<$3 and pe.points<>0 group by pe.student_id, pe.state`,
      [branch, ws, weekEnd],
    ),
    db.query<{ student_id: string; reason: string; pts: number; cnt: number }>(
      `select pn.student_id, pn.reason, sum(pn.points)::int as pts, count(*)::int as cnt from penalty_event pn
         join student s on s.id=pn.student_id and s.status='enrolled'
        where pn.branch_id=$1 and pn.date>=$2 and pn.date<$3 group by pn.student_id, pn.reason`,
      [branch, ws, weekEnd],
    ),
    // 이 주 안에 지점이 실제로 돌린 순찰 세션 수(학생별 아님) — 순찰 기인 점수 옆에 분모로 보여줘
    // "직원마다 순찰 횟수가 달라 같은 행동이 다른 점수가 된다"는 편차가 해석을 왜곡하지 않게 한다.
    db.query<{ n: number }>(`select count(*)::int as n from patrol_session where branch_id=$1 and date>=$2 and date<$3`, [branch, ws, weekEnd]),
  ]);
  const sessionCount = patrolSessions.rows[0]?.n ?? 0;

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
    ...[...patByState].map(([state, v]) => ({ label: `순찰 · ${PATROL_BY_KEY[state]?.label ?? state}`, points: v.pts, count: v.cnt, sessions: sessionCount })),
    ...[...manByReason].map(([reason, v]) => ({ label: PENALTY_BY_KEY[reason]?.label ?? reason, points: v.pts, count: v.cnt })),
  ].filter((b) => b.points > 0).sort((a, b) => b.points - a.points);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PhoneRedirect to="/penalty" />
      <PageHeader
        backHref="/m/seat"
        backLabel="좌석"
        title="벌점"
        flexNone
        right={
          <div className="flex items-center gap-2">
            <Link href={`/m/penalty?week=${prevWeek}`} className="chip" aria-label="이전 주" title="이전 주">‹</Link>
            <span style={{ fontSize: 12.5, fontWeight: isCurrentWeek ? 500 : 800, color: isCurrentWeek ? "var(--dim)" : "var(--accent)" }}>
              {isCurrentWeek ? `이번 주 ${wsLabel} ~ · 월요일 리셋` : `${wsLabel} ~ (지난 주 보는 중)`}
            </span>
            {!isCurrentWeek && <Link href="/m/penalty" className="chip" style={{ fontWeight: 700 }}>오늘로</Link>}
            {isCurrentWeek ? (
              <span className="chip" aria-disabled style={{ opacity: 0.35, pointerEvents: "none" }}>›</span>
            ) : (
              <Link href={`/m/penalty?week=${nextWeek}`} className="chip" aria-label="다음 주" title="다음 주">›</Link>
            )}
          </div>
        }
      />

      <PenaltyView
        rooms={rooms.rows}
        seats={seats.rows}
        students={students.rows}
        weekly={weekly}
        breakdown={breakdown}
        weekLabel={wsLabel}
        weekStart={ws}
        isCurrentWeek={isCurrentWeek}
        today={todayKey()}
        canManage={canManage}
        canPatrolManage={canPatrolManage}
      />
    </main>
  );
}
