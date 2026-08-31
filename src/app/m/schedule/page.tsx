import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/date";
import ScheduleDemo, { type SStudent } from "./ScheduleDemo";
import PageHeader from "../_shared/PageHeader";
import type { Period } from "./actions";

export const runtime = "nodejs";

// 학생 스케쥴러 — 학생 명단 + 지점 운영 시간표(교시)를 DB 에서 읽어 넘긴다.
// 정기·예외 일정 자체는 학생 선택 시 클라이언트가 listSchedule 서버액션으로 불러온다.
// ?student=<id> 로 진입하면(좌석 배치도·학생 상세에서) 그 학생을 미리 선택한 채로 연다.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "schedule.view")) redirect("/home");
  await ready();

  const [studentRows, periodRows, hoursCountRows] = await Promise.all([
    db.query<{ id: string; name: string; seat_number: number | null }>(
      `select s.id, s.name, seat.number as seat_number
         from student s
         left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.branch_id=$1 and s.status='enrolled'
        order by seat.number nulls last, s.name`,
      [me.activeBranchId],
    ),
    db.query<{ id: string; label: string; start_min: number; end_min: number; ord: number }>(
      `select id, label, start_min, end_min, ord from schedule_period where branch_id=$1 order by ord`,
      [me.activeBranchId],
    ),
    // 학생별 등하원 설정 여부 판정용 — 학생마다 개별 쿼리 대신 지점 전체를 한 번에 집계한다.
    db.query<{ student_id: string; cnt: number }>(
      `select student_id, count(*)::int as cnt from schedule_hours where branch_id=$1 group by student_id`,
      [me.activeBranchId],
    ),
  ]);
  const hoursCountOf = new Map(hoursCountRows.rows.map((r) => [r.student_id, r.cnt]));
  const students: SStudent[] = studentRows.rows.map((r) => ({ ...r, hoursCount: hoursCountOf.get(r.id) ?? 0 }));
  const initialPeriods: Period[] = periodRows.rows.map((r) => ({ id: r.id, label: r.label, start: r.start_min, end: r.end_min }));

  // ?student=<id> 가 이 지점의 재원생이면 그 학생으로 시작 — 아니면(없음·잘못된 id) 기존 동작(첫 학생).
  const wantedId = (await searchParams).student;
  const initialStudentId = wantedId && students.some((s) => s.id === wantedId) ? wantedId : null;

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader
        backHref="/home"
        backLabel="홈"
        title="학생 스케쥴러"
        flexNone
        right={
          <div className="flex items-center gap-3">
            <Link href="/m/schedule/import" className="chip" style={{ textDecoration: "none" }}>JSON 일괄 반영</Link>
            <div className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>
              학생 {students.length}명
            </div>
          </div>
        }
      />

      <ScheduleDemo students={students} today={todayKey()} initialPeriods={initialPeriods} initialStudentId={initialStudentId} />
    </main>
  );
}
