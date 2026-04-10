import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import Header            from "@/components/layout/Header";
import PortalClient      from "@/components/portal/PortalClient";
import { RoleRow }       from "@/types";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function PortalPage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role, approval_status")
    .eq("id", user.id)
    .single();

  // 승인 대기 중이면 pending 페이지로
  if (profile?.approval_status === "pending") redirect("/pending");

  const name      = profile?.name ?? "사용자";
  const roleName  = profile?.role ?? "user";

  // 현재 역할의 권한 가져오기
  const { data: roleData } = await supabase
    .from("roles")
    .select("name, label, color, permissions, category_order")
    .eq("name", roleName)
    .single();

  const permissions:    Record<string, string[]> = roleData?.permissions    ?? {};
  const category_order: string[]                 = roleData?.category_order ?? [];
  const roleLabel = roleData?.label ?? roleName;

  // admin 이면 모든 역할 목록도 가져오기 (뷰 스위처용)
  let allRoles: RoleRow[] = [];
  if (roleName === "admin") {
    const { data: rolesData } = await supabase
      .from("roles")
      .select("id, name, label, color, permissions, category_order, show_in_signup, created_at")
      .order("created_at");

    allRoles = (rolesData ?? []).map((r: any) => ({
      id:             r.id,
      name:           r.name,
      label:          r.label,
      color:          r.color,
      permissions:    r.permissions ?? {},
      category_order: r.category_order ?? [],
      show_in_signup: r.show_in_signup,
      created_at:     r.created_at,
    }));
  }

  return (
    <div className="min-h-screen bg-sc-bg flex flex-col">
      <Header name={name} role={roleName} roleLabel={roleLabel} />

      <main className="flex-1 w-full max-w-5xl mx-auto px-8 py-12">
        {/* 헤드라인 */}
        <div className="mb-10 animate-fade-up" style={{ animationFillMode: "forwards" }}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-sc-dim mb-3">
            StudyCUBE Portal
          </p>
          <h2 className="text-[28px] font-black text-sc-white leading-tight tracking-tight">
            안녕하세요, <span className="text-sc-green">{name}</span>님
          </h2>
          <p className="text-sc-dim text-sm mt-1.5 font-medium">
            오늘도 좋은 하루 되세요.
          </p>
        </div>

        <div className="border-t border-sc-border mb-10" />

        <PortalClient
          currentPermissions={{ permissions, category_order }}
          roleLabel={roleLabel}
          isAdmin={roleName === "admin"}
          allRoles={allRoles}
        />
      </main>
    </div>
  );
}
