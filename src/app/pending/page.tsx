"use client";

export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function PendingPage() {
  const supabase = createClient();
  const router   = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--sc-bg)" }}>
      <div className="w-full max-w-[380px] text-center">

        {/* 아이콘 */}
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
             style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
               stroke="#fbbf24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>

        <h2 className="text-2xl font-black mb-3" style={{ color: "var(--sc-white)" }}>
          승인 대기 중
        </h2>
        <p className="text-sm leading-relaxed mb-2" style={{ color: "var(--sc-dim)" }}>
          아직 관리자 승인이 완료되지 않았습니다.
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--sc-dim)" }}>
          승인 완료 후 다시 로그인해 주세요.
        </p>

        <button onClick={handleLogout}
          className="px-8 py-3 rounded-xl text-sm font-bold"
          style={{ background: "var(--sc-raised)", color: "var(--sc-white)", border: "1px solid var(--sc-border)" }}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
