import { createClient } from "@/lib/supabase/server";
import { redirect }      from "next/navigation";
import Link              from "next/link";
import ThemeToggle       from "@/components/ui/ThemeToggle";
import { HomeIcon }      from "@/components/ui/Icons";

const MIN_LOAD = new Promise((r) => setTimeout(r, 500));

export default async function FullSchedulePage() {
  const [, supabase] = await Promise.all([MIN_LOAD, createClient()]);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin","manager"].includes(profile.role)) redirect("/portal");

  // 모든 선생님 목록
  const { data: teachers } = await supabase
    .from("teachers")
    .select(`
      id,
      profiles ( id, name, phone )
    `)
    .order("created_at");

  // 모든 학생 목록
  const { data: students } = await supabase
    .from("students")
    .select(`
      id, grade, school,
      profiles ( id, name )
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
        <span style={{ color: "var(--sc-white)", fontSize: 14, fontWeight: 900 }}>전체 시간표</span>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 40 }}>
        {/* 교실 시간표 링크 */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sc-dim)", marginBottom: 12 }}>
            교실 시간표
          </p>
          <Link
            href="/manage/classroom-schedule"
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "16px 18px",
              background: "var(--sc-surface)",
              border: "1px solid var(--sc-green)",
              borderRadius: 12, textDecoration: "none",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "rgba(0,232,117,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sc-green)"
                strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/>
                <line x1="9" y1="9" x2="9" y2="21"/>
                <line x1="15" y1="9" x2="15" y2="21"/>
              </svg>
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, color: "var(--sc-white)", margin: 0 }}>교실 점유 시간표</p>
              <p style={{ fontSize: 12, color: "var(--sc-dim)", margin: "3px 0 0" }}>교실별 수업 배치 현황 확인</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--sc-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ marginLeft: "auto" }}>
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </Link>
        </div>

        {/* 선생님 목록 */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sc-dim)", marginBottom: 12 }}>
            선생님 시간표 · {(teachers ?? []).length}명
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(teachers ?? []).length === 0 && (
              <p style={{ color: "var(--sc-dim)", fontSize: 13, padding: "24px 0" }}>등록된 선생님이 없습니다.</p>
            )}
            {(teachers ?? []).map((t: any) => (
              <Link
                key={t.id}
                href={`/schedule/teacher/${t.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px",
                  background: "var(--sc-surface)",
                  border: "1px solid var(--sc-border)",
                  borderRadius: 10, textDecoration: "none",
                  transition: "border-color 0.15s",
                }}
                className="hover:border-[color:var(--sc-green)]"
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: "var(--sc-raised)",
                  border: "1px solid var(--sc-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 900, color: "var(--sc-green)", flexShrink: 0,
                }}>
                  {(t.profiles?.name ?? "T")[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "var(--sc-white)", margin: 0 }}>
                    {t.profiles?.name ?? "이름 없음"} T
                  </p>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="var(--sc-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </Link>
            ))}
          </div>
        </div>

        {/* 학생 목록 */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sc-dim)", marginBottom: 12 }}>
            학생 시간표 · {(students ?? []).length}명
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(students ?? []).length === 0 && (
              <p style={{ color: "var(--sc-dim)", fontSize: 13, padding: "24px 0" }}>등록된 학생이 없습니다.</p>
            )}
            {(students ?? []).map((s: any) => (
              <Link
                key={s.id}
                href={`/schedule/students/${s.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px",
                  background: "var(--sc-surface)",
                  border: "1px solid var(--sc-border)",
                  borderRadius: 10, textDecoration: "none",
                  transition: "border-color 0.15s",
                }}
                className="hover:border-[color:var(--sc-green)]"
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: "var(--sc-raised)",
                  border: "1px solid var(--sc-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 900, color: "var(--sc-green)", flexShrink: 0,
                }}>
                  {(s.profiles?.name ?? "?")[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "var(--sc-white)", margin: 0 }}>
                    {s.profiles?.name ?? "이름 없음"}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--sc-dim)", margin: "2px 0 0" }}>
                    {[s.grade, s.school].filter(Boolean).join(" · ") || "정보 없음"}
                  </p>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="var(--sc-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
