import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { weekStartLabel } from "@/lib/penalty";
import { weekStartKey } from "@/lib/date";
import MobilePenalty, { type PStudent } from "./MobilePenalty";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 폰용 벌점 — 순찰 돌며 즉시 주는 주 사용처라 전용 모듈 제거와 무관하게 그대로 둔다(집주인 판단).
// 데스크톱 집계는 순찰 기록 화면(/m/patrol)의 "벌점 현황" 탭으로, 개별 부여는 좌석 배치도 학생
// 상세의 벌점 사이드 패널로 흡수됐다.
export default async function MobilePenaltyPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "penalty.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;
  const ws = weekStartKey(new Date());

  // 재원생만 집계 — 데스크톱 화면과 같은 기준
  const [students, patRows, manRows] = await Promise.all([
    db.query<PStudent>(
      `select s.id, s.name, s.grade, seat.number as seat_number
         from student s left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.branch_id=$1 and s.status='enrolled' order by s.name`,
      [branch],
    ),
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
  ]);

  const weekly: Record<string, number> = {};
  for (const r of [...patRows.rows, ...manRows.rows]) weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;

  return (
    <MobilePenalty
      students={students.rows}
      weekly={weekly}
      weekLabel={weekStartLabel(ws)}
      canManage={can(me, "penalty.manage")}
    />
  );
}
