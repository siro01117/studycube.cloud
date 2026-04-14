import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import Link              from "next/link";
import ThemeToggle       from "@/components/ui/ThemeToggle";
import { HomeIcon }      from "@/components/ui/Icons";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function StudentListPage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // 일반 학생은 본인 시간표만 (바로 내 시간표로 리다이렉트)
  if (profile?.role === "user") redirect("/schedule/me");

  // 학생 목록 조회 (admin/manager)
  const { data: students } = await supabase
    .from("students")
    .select(`
      id, grade, school, memo,
      profiles ( id, name, phone, email )
    `)
    .order("created_at");

  return (
    <div style={{ minHeight: "100vh", background: "var(--sc-bg)" }}>
      {/* 헤더 */}
      <header style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--sc-surface)",
        borderBottom: "1px solid var(--sc-border)",
        padding: "0 20px", height: 52,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <Link href="/portal" style={{
          display: "flex", alignItems: "center", gap: 6,
          color: "var(--sc-dim)", fontSize: 13, fontWeight: 700, textDecoration: "none",
        }}>
          <HomeIcon />
          포털
        </Link>
        <span style={{ color: "var(--sc-border)", fontSize: 18 }}>·</span>
        <span style={{ color: "var(--sc-white)", fontSize: 14, fontWeight: 900 }}>학생 목록</span>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </header>

      {/* 본문 */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sc-dim)", marginBottom: 8 }}>
            일정 관리 · 학생 목록
          </p>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "var(--sc-white)", margin: 0 }}>
            학생 시간표 조회
          </h2>
          <p style={{ fontSize: 13, color: "var(--sc-dim)", marginTop: 6 }}>
            학생을 선택해서 수강 중인 시간표를 확인하세요.
          </p>
        </div>

        {/* 학생 카드 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(students ?? []).length === 0 && (
            <p style={{ color: "var(--sc-dim)", fontSize: 13, textAlign: "center", padding: "48px 0" }}>
              등록된 학생이 없습니다.
            </p>
          )}
          {(students ?? []).map((s: any) => (
            <Link
              key={s.id}
              href={`/schedule/students/${s.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px",
                background: "var(--sc-surface)",
                border: "1px solid var(--sc-border)",
                borderRadius: 12,
                textDecoration: "none",
                transition: "border-color 0.15s, background 0.15s",
              }}
              className="hover:border-[color:var(--sc-green)] hover:bg-[color:var(--sc-raised)]"
            >
              {/* 아바타 */}
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "var(--sc-raised)",
                border: "1px solid var(--sc-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 900, color: "var(--sc-green)",
                flexShrink: 0,
              }}>
                {(s.profiles?.name ?? "?")[0]}
              </div>

              {/* 이름/정보 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: "var(--sc-white)", margin: 0 }}>
                  {s.profiles?.name ?? "이름 없음"}
                </p>
                <p style={{ fontSize: 11, color: "var(--sc-dim)", margin: "3px 0 0" }}>
                  {[s.grade, s.school].filter(Boolean).join(" · ") || "정보 없음"}
                </p>
              </div>

              {/* 화살표 */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="var(--sc-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
