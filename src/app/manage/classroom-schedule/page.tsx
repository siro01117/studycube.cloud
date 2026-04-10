import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ScheduleClient from "@/components/classroom-schedule/ScheduleClient";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function ClassroomSchedulePage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 권한 확인
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "manager"].includes(profile.role)) {
    redirect("/portal");
  }

  // 교실 목록
  const { data: classrooms } = await supabase
    .from("classrooms")
    .select("id, name, floor")
    .order("floor", { ascending: false })
    .order("name");

  // 고정 일정 (강사 + 수업 + 색상 조인)
  const { data: fixedSchedules } = await supabase
    .from("classroom_schedules")
    .select(`
      id, day, start_time, end_time, effective_from, effective_until,
      courses ( id, name, subject, instructor_id, accent_color, enrolled_names,
        instructors ( id, name, color )
      ),
      classrooms ( id, name )
    `)
    .or("effective_until.is.null,effective_until.gte." + new Date().toISOString().split("T")[0]);

  return (
    <ScheduleClient
      classrooms={classrooms ?? []}
      fixedSchedules={(fixedSchedules as any) ?? []}
    />
  );
}
