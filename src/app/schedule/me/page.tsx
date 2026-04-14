import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import MyScheduleClient  from "@/components/my-schedule/MyScheduleClient";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function MySchedulePage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  const today = new Date().toISOString().split("T")[0];
  const role  = profile.role as string;

  // ── 선생님/매니저/관리자: classroom_schedules (내 강의) + personal_schedules
  if (role === "admin" || role === "manager" || role === "teacher") {
    // teacher 레코드 조회
    const { data: teacherRow } = await supabase
      .from("teachers")
      .select("id")
      .eq("profile_id", user.id)
      .single();

    const teacherId = teacherRow?.id ?? null;

    // 강의 일정
    const { data: classSchedules } = teacherId
      ? await supabase
          .from("classroom_schedules")
          .select(`
            id, day, start_time, end_time, effective_from, effective_until,
            courses ( id, name, subject, accent_color ),
            classrooms ( id, name )
          `)
          .eq("teacher_id", teacherId)
          .or(`effective_until.is.null,effective_until.gte.${today}`)
      : { data: [] };

    // 개인 일정
    const { data: personalSchedules } = await supabase
      .from("personal_schedules")
      .select("*")
      .eq("profile_id", user.id)
      .eq("is_active", true);

    return (
      <MyScheduleClient
        userRole={role}
        userName={profile.name}
        classSchedules={(classSchedules ?? []) as any[]}
        personalSchedules={(personalSchedules ?? []) as any[]}
        userId={user.id}
      />
    );
  }

  // ── 학생: 수강 중인 수업 시간표 + personal_schedules
  const { data: studentRow } = await supabase
    .from("students")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  const studentId = studentRow?.id ?? null;

  const { data: enrollments } = studentId
    ? await supabase
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
        .eq("is_active", true)
    : { data: [] };

  const { data: personalSchedules } = await supabase
    .from("personal_schedules")
    .select("*")
    .eq("profile_id", user.id)
    .eq("is_active", true);

  return (
    <MyScheduleClient
      userRole={role}
      userName={profile.name}
      classSchedules={[]}
      enrollments={(enrollments ?? []) as any[]}
      personalSchedules={(personalSchedules ?? []) as any[]}
      userId={user.id}
    />
  );
}
