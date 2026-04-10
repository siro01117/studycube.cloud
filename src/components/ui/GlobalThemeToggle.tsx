"use client";

import { useState, useEffect } from "react";

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

/**
 * 전역 테마 토글 버튼 — ThemeProvider에 의존하지 않고 직접 DOM 조작
 * 모든 페이지에서 우측 상단에 표시됨
 */
export default function GlobalThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // 현재 테마 읽기
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  function toggle() {
    const next = !isDark;
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try {
      localStorage.setItem("sc-theme", next ? "dark" : "light");
    } catch {}
    setIsDark(next);

    // Supabase 계정 설정도 업데이트 (비동기, 실패해도 무관)
    try {
      import("@/lib/supabase/client").then(({ createClient }) => {
        const sb = createClient();
        sb.auth.getUser().then(({ data: { user } }) => {
          if (!user) return;
          sb.from("profiles").update({ theme: next ? "dark" : "light" }).eq("id", user.id);
        });
      });
    } catch {}
  }

  // 모드에 따라 시각적으로 차별화 (hydration 안전: isDark는 useEffect 후 업데이트)
  const btnStyle: React.CSSProperties = isDark
    ? {
        // 다크 모드: 형광 그린 테두리 글로우 → 배경에서 잘 보임
        background:    "rgba(20,20,20,0.92)",
        border:        "1px solid rgba(0,255,133,0.45)",
        color:         "#00FF85",
        boxShadow:     "0 0 12px rgba(0,255,133,0.18), 0 4px 16px rgba(0,0,0,0.5)",
      }
    : {
        // 라이트 모드: 매트 그린 테두리 + 그림자
        background:    "rgba(255,255,255,0.95)",
        border:        "1px solid rgba(0,138,68,0.35)",
        color:         "#008A44",
        boxShadow:     "0 2px 12px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,138,68,0.1)",
      };

  return (
    <button
      onClick={toggle}
      title={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      style={{
        position:       "fixed",
        top:            18,
        right:          24,
        zIndex:         99999,
        width:          40,
        height:         40,
        borderRadius:   "50%",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        cursor:         "pointer",
        backdropFilter: "blur(8px)",
        transition:     "background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.15s",
        ...btnStyle,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.12)";
        e.currentTarget.style.boxShadow = isDark
          ? "0 0 20px rgba(0,255,133,0.35), 0 4px 20px rgba(0,0,0,0.6)"
          : "0 4px 20px rgba(0,0,0,0.2), 0 0 0 2px rgba(0,138,68,0.25)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = btnStyle.boxShadow as string;
      }}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
