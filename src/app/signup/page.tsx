"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { signupUser } from "./actions";
import { createClient } from "@/lib/supabase/client";
import DateInput from "@/components/ui/DateInput";

import CubeIcon from "@/components/ui/CubeIcon";
import ThemeToggle from "@/components/ui/ThemeToggle";

interface RoleOption { name: string; label: string; color: string; }

const GENDER_OPTIONS = [
  { value: "male",   label: "남" },
  { value: "female", label: "여" },
];

export default function SignupPage() {
  const supabase = createClient();

  const [roles,     setRoles]     = useState<RoleOption[]>([]);
  const [pending,   startTrans]   = useTransition();
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // 폼 필드
  const [loginId,   setLoginId]   = useState("");
  const [password,  setPassword]  = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [showPw2,   setShowPw2]   = useState(false);
  const [name,      setName]      = useState("");
  const [role,      setRole]      = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [school,    setSchool]    = useState("");
  const [phone,     setPhone]     = useState("");
  const [gender,    setGender]    = useState("");

  // 회원가입에 노출할 역할 불러오기
  useEffect(() => {
    supabase
      .from("roles")
      .select("name, label, color")
      .eq("show_in_signup", true)
      .order("created_at")
      .then(({ data }) => {
        if (data) {
          setRoles(data);
          if (data.length > 0) setRole(data[0].name);
        }
      });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) { setError("비밀번호가 일치하지 않습니다."); return; }
    startTrans(async () => {
      try {
        await signupUser({ loginId, password, name, role, birthdate: birthdate || undefined, school: school || undefined, phone: phone || undefined, gender: gender || undefined });
        setDone(true);
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--sc-bg)" }}>
        <div className="w-full max-w-[360px] text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
               style={{ background: "var(--card-spot)", border: "1px solid var(--card-glow)" }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--sc-green)" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-3" style={{ color: "var(--sc-white)" }}>
            가입 신청 완료!
          </h2>
          <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--sc-dim)" }}>
            관리자 승인 후 로그인이 가능합니다.<br />
            승인이 완료되면 아이디와 비밀번호로 로그인해 주세요.
          </p>
          <Link href="/login"
            className="inline-block px-8 py-3 rounded-xl text-sm font-black"
            style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
            로그인 화면으로 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10" style={{ background: "var(--sc-bg)" }}>
      {/* 우측 상단 테마 토글 */}
      <div className="fixed top-5 right-6 z-50">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[400px]">

        {/* 로고 */}
        <div className="flex items-center gap-2.5 mb-8 animate-fade-in" style={{ animationFillMode: "forwards" }}>
          <CubeIcon />
          <span className="font-black text-[17px] tracking-tight" style={{ color: "var(--sc-white)" }}>
            Study<span style={{ color: "var(--sc-green)" }}>CUBE</span>
          </span>
        </div>

        {/* 헤드라인 */}
        <div className="mb-8">
          <h1 className="text-[28px] font-black leading-[1.1] tracking-tight" style={{ color: "var(--sc-white)" }}>
            회원가입
          </h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: "var(--sc-dim)" }}>
            가입 후 관리자 승인이 필요합니다
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* 아이디 */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
              아이디 *
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              placeholder="영문, 숫자, 밑줄 3자 이상"
              autoComplete="username"
              className="sc-input w-full"
            />
            <p className="text-[10px] mt-1" style={{ color: "var(--sc-dim)" }}>
              영문, 숫자, 밑줄(_)만 사용 가능 · 로그인 아이디로 사용됩니다
            </p>
          </div>

          {/* 비밀번호 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
                비밀번호 *
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="8자 이상"
                  minLength={8}
                  autoComplete="new-password"
                  className="sc-input w-full"
                  style={{ paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: "var(--sc-dim)", lineHeight: 0 }}>
                  {showPw
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
                비밀번호 확인 *
              </label>
              <div className="relative">
                <input
                  type={showPw2 ? "text" : "password"}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="sc-input w-full"
                  style={{ paddingRight: 36 }}
                />
                <button type="button" onClick={() => setShowPw2((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: "var(--sc-dim)", lineHeight: 0 }}>
                  {showPw2
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>
          </div>

          {/* 이름 */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
              이름 *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="홍길동"
              className="sc-input w-full"
            />
          </div>

          {/* 역할 */}
          {roles.length > 0 && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--sc-dim)" }}>
                역할 *
              </label>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const on = role === r.name;
                  return (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => setRole(r.name)}
                      className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: on ? `${r.color}22` : "var(--sc-raised)",
                        color:      on ? r.color         : "var(--sc-dim)",
                        border:     `1px solid ${on ? r.color : "var(--sc-border)"}`,
                        transform:  on ? "scale(1.03)" : "scale(1)",
                      }}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 구분선 */}
          <div style={{ height: 1, background: "var(--sc-border)" }} />

          {/* 생년월일 + 학교 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
                생년월일
              </label>
              <DateInput value={birthdate} onChange={setBirthdate} />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
                학교
              </label>
              <input
                type="text"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="○○고등학교"
                className="sc-input w-full"
              />
            </div>
          </div>

          {/* 연락처 + 성별 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>
                연락처
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="sc-input w-full"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--sc-dim)" }}>
                성별
              </label>
              <div className="flex gap-1.5">
                {GENDER_OPTIONS.map((g) => {
                  const on = gender === g.value;
                  return (
                    <button key={g.value} type="button" onClick={() => setGender(on ? "" : g.value)}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: on ? "var(--sc-green)" : "var(--sc-raised)",
                        color:      on ? "var(--sc-bg)"    : "var(--sc-dim)",
                        border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                      }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 에러 */}
          {error && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-2"
                 style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <span style={{ color: "#f87171", fontSize: 13, marginTop: 1 }}>!</span>
              <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>
            </div>
          )}

          {/* 가입 버튼 */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={pending}
              className="w-full py-3.5 rounded-xl text-sm font-black tracking-wide transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
              {pending ? "신청 중..." : "가입 신청 →"}
            </button>
          </div>
        </form>

        {/* 로그인 링크 */}
        <p className="text-center text-[12px] mt-5" style={{ color: "var(--sc-dim)" }}>
          이미 계정이 있나요?{" "}
          <Link href="/login"
            className="font-bold transition-colors"
            style={{ color: "var(--sc-white)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sc-green)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sc-white)")}>
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
