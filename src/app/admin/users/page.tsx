import { createClient }      from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect }          from "next/navigation";
import Link                  from "next/link";
import UserManager, { UserRow } from "@/components/admin/UserManager";
import RoleManager               from "@/components/admin/RoleManager";
import ThemeToggle               from "@/components/ui/ThemeToggle";
import { RoleRow }               from "@/types";

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [, params] = await Promise.all([MIN_LOAD, searchParams]);
  const tab    = params.tab === "roles" ? "roles" : "users";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (myProfile?.role !== "admin") redirect("/portal");

  const admin = createAdminClient();

  // ── 역할 목록 ──────────────────────────────────────────────────
  const { data: rolesData } = await admin
    .from("roles")
    .select("id, name, label, color, permissions, category_order, show_in_signup, created_at")
    .order("created_at");

  const roles: RoleRow[] = (rolesData ?? []).map((r: any) => ({
    id:             r.id,
    name:           r.name,
    label:          r.label,
    color:          r.color,
    permissions:    r.permissions ?? {},
    category_order: r.category_order ?? [],
    show_in_signup: r.show_in_signup,
    created_at:     r.created_at,
  }));

  // ── 유저 목록 (Admin API + profiles 조인) ─────────────────────
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUsers = authData?.users ?? [];

  const { data: profilesData } = await admin
    .from("profiles")
    .select("id, name, login_id, role, birthdate, school, phone, gender, approval_status, created_at");

  const profilesMap = Object.fromEntries(
    (profilesData ?? []).map((p: any) => [p.id, p])
  );

  const users: UserRow[] = authUsers
    .map((au) => {
      const p = profilesMap[au.id] ?? {};
      return {
        id:              au.id,
        name:            p.name ?? au.user_metadata?.name ?? "이름 없음",
        login_id:        p.login_id ?? undefined,
        email:           au.email ?? "",
        role:            p.role ?? "user",
        birthdate:       p.birthdate ?? undefined,
        school:          p.school ?? undefined,
        phone:           p.phone ?? undefined,
        gender:          p.gender ?? undefined,
        approval_status: p.approval_status ?? "approved",
        created_at:      p.created_at ?? au.created_at,
        last_sign_in:    au.last_sign_in_at ?? undefined,
      } satisfies UserRow;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const pendingCount = users.filter((u) => u.approval_status === "pending").length;

  return (
    <div className="min-h-screen" style={{ background: "var(--sc-bg)" }}>
      {/* 헤더 */}
      <div className="sticky top-0 z-30 px-8 pt-6 pb-4"
           style={{ background: "var(--sc-bg)", borderBottom: "1px solid var(--sc-border)", backdropFilter: "blur(12px)" }}>

        {/* 브레드크럼 + 테마 토글 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <Link href="/portal"
              className="flex items-center gap-1.5 text-xs font-semibold hover:opacity-100 transition-opacity"
              style={{ color: "var(--sc-dim)", opacity: 0.6 }}>
              <HomeIcon /> 홈
            </Link>
            <span style={{ color: "var(--sc-border)" }}>/</span>
            <span className="text-xs font-semibold" style={{ color: "var(--sc-dim)" }}>유저 관리</span>
          </div>
          <ThemeToggle />
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--sc-dim)" }}>Admin</p>
          <h1 className="text-2xl font-black" style={{ color: "var(--sc-white)" }}>유저 관리</h1>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mt-4">
          {([
            { key: "users", label: "유저 목록", badge: pendingCount > 0 ? pendingCount : null },
            { key: "roles", label: "역할 관리", badge: null },
          ] as const).map(({ key, label, badge }) => {
            const on = tab === key;
            return (
              <Link key={key} href={`/admin/users?tab=${key}`}
                className="px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all"
                style={{
                  background: on ? "var(--sc-green)" : "var(--sc-raised)",
                  color:      on ? "var(--sc-bg)"    : "var(--sc-dim)",
                  border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                }}>
                {label}
                {badge !== null && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black"
                        style={{ background: on ? "rgba(0,0,0,0.2)" : "rgba(251,191,36,0.2)", color: on ? "var(--sc-bg)" : "#fbbf24" }}>
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 바디 */}
      <div className="px-8 py-6 max-w-screen-xl mx-auto">
        {tab === "users" ? (
          <UserManager users={users} roles={roles} currentUserId={user.id} />
        ) : (
          <RoleManager roles={roles} />
        )}
      </div>
    </div>
  );
}
