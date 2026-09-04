import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import StudentList from "./StudentList";
import type { Student } from "./util";
import PageHeader from "../_shared/PageHeader";

export const runtime = "nodejs";

export default async function StudentPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "student.view")) redirect("/home");
  await ready();
  const canEdit = can(me, "student.edit");
  const canAttend = can(me, "attendance.edit");
  const canManageSeat = can(me, "seat.manage");
  const canSms = can(me, "sms.manage"); // 링크·로그인 코드 안내 문자 — sms.* 축, student.edit 과 별개(집주인 지시)

  // 좌석 join 에 room 을 한 번 더 얹어 교실 정보까지 같은 쿼리로 가져온다(N+1 방지 — 방마다
  // 따로 조회하지 않고 여기서 한 번에 받아 클라이언트(StudentList)가 room_id 로 묶는다).
  const { rows } = await db.query<Student>(
    `select s.id, s.name, s.level, s.grade, s.school, s.is_repeat, s.status,
            s.guardian_phone, s.student_phone,
            s.birthdate::text as birthdate, s.enrolled_at::text as enrolled_at, s.access_code,
            seat.number as seat_number, seat.id as seat_id,
            seat.room_id as room_id, r.name as room_name, r.floor as room_floor
       from student s
       left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
       left join room r on r.id = seat.room_id
      where s.branch_id = $1
      order by s.name`,
    [me.activeBranchId],
  );
  const enrolled = rows.filter((s) => s.status === "enrolled").length;

  return (
    <main style={{ minHeight: "100dvh" }}>
      <PageHeader
        backHref="/home"
        backLabel="대시보드"
        backLinkStyle={{ cursor: "pointer" }}
        title="학생 관리"
        maxWidth
        right={
          <div className="flex items-center gap-3">
            <Link href="/m/submission" className="chip" style={{ cursor: "pointer" }}>신청·설문 응답 →</Link>
            <div style={{ fontSize: 12.5, color: "var(--sub)" }}>재원 {enrolled} · 전체 {rows.length}</div>
          </div>
        }
      />

      <div className="mx-auto max-w-[1080px] px-5 py-5">
        <StudentList students={rows} canEdit={canEdit} canAttend={canAttend} canManageSeat={canManageSeat} canSms={canSms} />
      </div>
    </main>
  );
}
