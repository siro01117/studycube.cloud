"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import CubeIcon from "@/components/ui/CubeIcon";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function Header({ name, role, roleLabel }: { name: string; role: string; roleLabel?: string }) {
  const router   = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // 역할 표시 레이블과 색상 동적 결정
  const displayLabel = roleLabel ?? role.toUpperCase();
  const badgeStyle = role === "admin"
    ? "text-sc-green bg-[color:var(--sc-green)]/10 border-[color:var(--sc-green)]/20"
    : "text-sc-dim bg-sc-raised border-sc-border";

  return (
    <header
      className="flex items-center justify-between px-8 py-4 sticky top-0 z-50"
      style={{
        backgroundColor: "var(--sc-bg)",
        borderBottom: "1px solid var(--sc-border)",
        backdropFilter: "blur(12px)",
        transition: "background-color 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* 로고 */}
      <div className="flex items-center gap-2">
        <CubeIcon />
        <span className="font-black text-[16px] tracking-tight" style={{ color: "var(--sc-white)" }}>
          Study<span style={{ color: "var(--sc-green)" }}>CUBE</span>
        </span>
      </div>

      {/* 우측 */}
      <div className="flex items-center gap-3">
        {/* 역할 뱃지 */}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border tracking-widest ${badgeStyle}`}>
          {displayLabel}
        </span>

        {/* 이름 */}
        <span className="text-sm font-semibold" style={{ color: "var(--sc-white)" }}>
          {name}
        </span>

        {/* 구분선 */}
        <div className="w-px h-4" style={{ background: "var(--sc-border)" }} />

        {/* 테마 토글 */}
        <ThemeToggle />

        {/* 구분선 */}
        <div className="w-px h-4" style={{ background: "var(--sc-border)" }} />

        {/* 로그아웃 */}
        <button
          onClick={handleLogout}
          className="text-[12px] font-medium transition-colors duration-150"
          style={{ color: "var(--sc-dim)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sc-white)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sc-dim)")}
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}
