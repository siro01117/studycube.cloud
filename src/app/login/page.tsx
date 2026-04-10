"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

import CubeIcon from "@/components/ui/CubeIcon";
import ThemeToggle from "@/components/ui/ThemeToggle";

// ── 아이디/비번 찾기 팝업 ──────────────────────────────────────────
function ForgotPopup({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50"
           style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
           onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-xs rounded-2xl p-7 shadow-2xl text-center"
           style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)" }}
           onClick={(e) => e.stopPropagation()}>
        {/* 아이콘 */}
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
             style={{ background: "var(--card-spot)", border: "1px solid var(--card-glow)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               style={{ stroke: "var(--sc-green)" }} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>

        <h3 className="font-black text-lg mb-2" style={{ color: "var(--sc-white)" }}>
          아이디 / 비밀번호 찾기
        </h3>
        <p className="text-sm leading-relaxed mb-1" style={{ color: "var(--sc-dim)" }}>
          계정 정보를 잊으셨나요?
        </p>
        <p className="text-sm font-semibold mb-6" style={{ color: "var(--sc-white)" }}>
          스터디큐브 데스크로 문의 주세요
        </p>

        <button onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-bold"
          style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
          확인
        </button>
      </div>
    </>
  );
}

// ── 메인 로그인 페이지 ─────────────────────────────────────────────
export default function LoginPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [loginId,   setLoginId]   = useState("");
  const [password,  setPassword]  = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [showForgot,setShowForgot]= useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginId.trim()) { setError("아이디를 입력하세요."); return; }
    setLoading(true);
    setError(null);

    // 이메일 형식이면 그대로, 아니면 @studycube.app 붙여서 인증
    const raw = loginId.trim();
    const email = raw.includes("@") ? raw : `${raw.toLowerCase()}@studycube.app`;
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });

    if (authErr) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-sc-bg flex items-center justify-center px-6">
      {/* 우측 상단 테마 토글 */}
      <div className="fixed top-5 right-6 z-50">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[360px]">

        {/* 로고 */}
        <div className="flex items-center gap-2.5 mb-12 animate-fade-in"
             style={{ animationFillMode: "forwards" }}>
          <CubeIcon />
          <span className="text-sc-white font-black text-[18px] tracking-tight">
            Study<span className="text-sc-green">CUBE</span>
          </span>
        </div>

        {/* 헤드라인 */}
        <div className="mb-10 animate-fade-up"
             style={{ animationFillMode: "forwards", animationDelay: "60ms" }}>
          <h1 className="text-[32px] font-black text-sc-white leading-[1.1] tracking-tight">
            로그인
          </h1>
          <p className="text-sc-dim text-sm mt-2 font-medium">
            StudyCUBE 관리 포탈에 오신 걸 환영해요
          </p>
        </div>

        {/* 폼 */}
        <form
          onSubmit={handleLogin}
          className="space-y-3 animate-fade-up"
          style={{ animationFillMode: "forwards", animationDelay: "120ms" }}
        >
          {/* 아이디 */}
          <div>
            <label className="block text-[11px] font-bold text-sc-dim uppercase tracking-widest mb-2">
              아이디
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              placeholder="아이디 입력"
              autoComplete="username"
              className="sc-input"
            />
          </div>

          {/* 비밀번호 */}
          <div>
            <label className="block text-[11px] font-bold text-sc-dim uppercase tracking-widest mb-2">
              비밀번호
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
                className="sc-input w-full"
                style={{ paddingRight: 40 }}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
                style={{ color: "var(--sc-dim)", lineHeight: 0 }}>
                {showPw
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {/* 에러 */}
          {error && (
            <div className="bg-[#1C1C1C] border border-[#2A2A2A] rounded-xl px-4 py-3 flex items-center gap-2">
              <span style={{ color: "var(--sc-green)", fontSize: 13 }}>!</span>
              <p className="text-sc-gray text-xs">{error}</p>
            </div>
          )}

          {/* 로그인 버튼 */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={loading}
              style={{ transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease" }}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.96)")}
              onMouseUp={(e)   => (e.currentTarget.style.transform = "")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
              className="w-full bg-sc-green hover:bg-sc-green-d disabled:opacity-40
                         text-[#141414] font-black py-3.5 rounded-xl text-sm tracking-wide"
            >
              {loading ? "로그인 중..." : "로그인 →"}
            </button>
          </div>
        </form>

        {/* 하단 링크 영역 */}
        <div className="mt-6 flex items-center justify-between animate-fade-in"
             style={{ animationFillMode: "forwards", animationDelay: "300ms" }}>
          {/* 회원가입 링크 */}
          <Link href="/signup"
            className="text-[12px] font-semibold transition-colors"
            style={{ color: "var(--sc-dim)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sc-green)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sc-dim)")}>
            회원가입 →
          </Link>

          {/* 아이디/비번 찾기 */}
          <button
            onClick={() => setShowForgot(true)}
            className="text-[12px] font-medium transition-colors"
            style={{ color: "var(--sc-dim)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sc-white)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sc-dim)")}>
            아이디 / 비밀번호 찾기
          </button>
        </div>
      </div>

      {/* 아이디/비번 찾기 팝업 */}
      {showForgot && <ForgotPopup onClose={() => setShowForgot(false)} />}
    </div>
  );
}
