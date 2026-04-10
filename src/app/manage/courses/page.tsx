import { createClient } from "@/lib/supabase/server";
import { redirect }     from "next/navigation";
import CourseManager    from "@/components/courses/CourseManager";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function CoursesPage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "manager"].includes(profile.role)) {
    redirect("/portal");
  }

  return <CourseManager />;
}
