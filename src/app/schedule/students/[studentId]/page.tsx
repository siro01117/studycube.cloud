import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import MyScheduleClient  from "@/components/my-schedule/MyScheduleClient";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function StudentSchedulePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const [, supabase, { studentId }] = await Promise.all([MIN_LOAD, createClient(), params]);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 권한 확인 (admin/manager만)
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!myProfile || myProfile.role === "user") redirect("/schedule/me");

  const today = new Date().toISOString().split("T")[0];

  // 학생 정보 + 수강 내역
  const { data: student } = await supabase
    .from("students")
    .select(`
      id,
      profiles ( id, name, role )
    `)
    .eq("id", studentId)
    .single();

  if (!student) redirect("/schedule/students");

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(`
      id, course_id, is_active,
      courses (
        id, name, subject, accent_color,
        classroom_schedules ( id, day, start_time, end_time, effective_from, effective_until ),
        instructors ( id, name, color )
      )
    `)
    .eq("student_id", studentId)
    .eq("is_active", true);

  const { data: personalSchedules } = await supabase
    .from("personal_schedules")
    .select("*")
    .eq("profile_id", (student as any).profiles?.id ?? "")
    .eq("is_active", true);

  const studentName = (student as any).profiles?.name ?? "학생";

  return (
    <MyScheduleClient
      userRole="user"
      userName={studentName}
      userId={(student as any).profiles?.id ?? ""}
      classSchedules={[]}
      enrollments={(enrollments ?? []) as any[]}
      personalSchedules={(personalSchedules ?? []) as any[]}
      readOnly
    />
  );
}
