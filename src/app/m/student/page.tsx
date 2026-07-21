import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import StudentList from "./StudentList";
import type { Student } from "./util";

export const runtime = "nodejs";

export default async function StudentPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "student.view")) redirect("/home");
  await ready();
  const canEdit = can(me, "student.edit");
  const canAttend = can(me, "attendance.edit");
  const canManageSeat = can(me, "seat.manage");

  const { rows } = await db.query<Student>(
    `select s.id, s.name, s.level, s.grade, s.school, s.is_repeat, s.status,
            s.guardian_phone, s.student_phone,
            s.birthdate::text as birthdate, s.enrolled_at::text as enrolled_at,
            seat.number as seat_number, seat.id as seat_id
       from student s
       left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
      where s.branch_id = $1
      order by s.name`,
    [me.activeBranchId],
  );
  const enrolled = rows.filter((s) => s.status === "enrolled").length;

  return (
    <main style={{ minHeight: "100dvh" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)" }}>
        <div className="mx-auto max-w-[1080px] px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/home" className="chip" style={{ cursor: "pointer" }}>‹ 홈</Link>
            <span style={{ fontWeight: 700 }}>학생 관리</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>재원 {enrolled} · 전체 {rows.length}</div>
        </div>
      </header>

      <div className="mx-auto max-w-[1080px] px-5 py-5">
        <StudentList students={rows} canEdit={canEdit} canAttend={canAttend} canManageSeat={canManageSeat} />
      </div>
    </main>
  );
}
