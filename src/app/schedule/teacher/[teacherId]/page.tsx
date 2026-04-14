import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import MyScheduleClient  from "@/components/my-schedule/MyScheduleClient";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function TeacherSchedulePage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const [, supabase, { teacherId }] = await Promise.all([MIN_LOAD, createClient(), params]);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // admin/manager만 타 선생님 시간표 열람 가능
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!myProfile || !["admin","manager"].includes(myProfile.role)) redirect("/portal");

  const today = new Date().toISOString().split("T")[0];

  // 선생님 정보
  const { data: teacher } = await supabase
    .from("teachers")
    .select(`id, profiles ( id, name )`)
    .eq("id", teacherId)
    .single();

  if (!teacher) redirect("/admin/full-schedule");

  // 강의 일정
  const { data: classSchedules } = await supabase
    .from("classroom_schedules")
    .select(`
      id, day, start_time, end_time, effective_from, effective_until,
      courses ( id, name, subject, accent_color ),
      classrooms ( id, name )
    `)
    .eq("teacher_id", teacherId)
    .or(`effective_until.is.null,effective_until.gte.${today}`);

  // 개인 일정
  const { data: personalSchedules } = await supabase
    .from("personal_schedules")
    .select("*")
    .eq("profile_id", (teacher as any).profiles?.id ?? "")
    .eq("is_active", true);

  const teacherName = (teacher as any).profiles?.name ?? "선생님";

  return (
    <MyScheduleClient
      userRole="teacher"
      userName={teacherName}
      userId={(teacher as any).profiles?.id ?? ""}
      classSchedules={(classSchedules ?? []) as any[]}
      personalSchedules={(personalSchedules ?? []) as any[]}
      readOnly
    />
  );
}
