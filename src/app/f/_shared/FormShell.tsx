"use client";

// 공개 폼(/f/**) 공통 셸 — 모바일 우선(학생은 폰으로 연다). 로고+제목만 노출,
// 직원 화면 내비게이션(레일·메뉴)은 절대 넣지 않는다.
//
// backHref 를 주면 제목 위에 작은 "‹ 홈" 링크가 뜬다(허브(Hub.tsx)는 이 prop 을 주지 않아 안 뜬다).
// confirmLeave=true 면 클릭 시 작성 중인 내용이 사라진다는 확인을 먼저 받는다(완료·읽기전용 화면은
// false 로 바로 이동). 대상 슬러그는 호출부가 registry.ts 의 getHubSlug() 로 구해서 넘긴다.
import Link from "next/link";

export default function FormShell({
  title,
  subtitle,
  maxWidth = 460,
  children,
  backHref,
  confirmLeave = false,
}: {
  title: string;
  subtitle?: string;
  maxWidth?: number;
  children: React.ReactNode;
  backHref?: string;
  confirmLeave?: boolean;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "28px 16px 40px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <LogoMark />
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--sub)", letterSpacing: "-0.01em" }}>스터디큐브</span>
      </div>
      <div
        style={{
          width: "100%",
          maxWidth,
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: 20,
          padding: "clamp(18px, 4vw, 26px)",
          boxShadow: "0 10px 40px rgba(20,22,30,.07)",
        }}
      >
        {backHref && (
          <Link
            href={backHref}
            onClick={(e) => {
              if (confirmLeave && !window.confirm("작성 중인 내용이 사라져요. 나갈까요?")) {
                e.preventDefault();
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              height: 40,
              marginBottom: 2,
              marginLeft: -6,
              padding: "0 6px",
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--sub)",
              textDecoration: "none",
            }}
          >
            <ChevronLeftIcon />홈
          </Link>
        )}
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: subtitle ? 4 : 16 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 18, lineHeight: 1.5 }}>{subtitle}</div>}
        {children}
      </div>
    </main>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="10.5 3.5 5.5 8 10.5 12.5" />
    </svg>
  );
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <line x1="3" y1="9" x2="21" y2="9" />
    </svg>
  );
}
