"use client";

// 태블릿 전용 상단 탭 — 폰의 시트(누르고 → 열고 → 고르고 3탭)를 항상 보이는 3칸 탭으로 바꿔
// 화면 전환을 1탭으로 줄인다(순찰이 주 용도라 자주 오간다). 목록도 3개뿐이라 시트로 감쌀 이유가 없다.
// 순찰이 태블릿의 기본 화면이라 항상 맨 앞에 둔다(§1 — 자주 쓰는 것을 가깝게).
import Link from "next/link";
import { setDeviceMode, TABLET_TO_PHONE } from "./device";

export const TABLET_SCREENS = [
  { href: "/t/patrol", label: "순찰" },
  { href: "/t/seat", label: "좌석" },
  { href: "/t/records", label: "기록" },
] as const;

const ICON: Record<string, React.ReactNode> = {
  "/t/patrol": <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  "/t/seat": <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  "/t/records": <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

export default function TabletNav({ current }: { current: keyof typeof TABLET_TO_PHONE }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "stretch", gap: 6, padding: "6px 8px", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
      {TABLET_SCREENS.map((s) => {
        const on = s.href === current;
        return (
          <Link key={s.href} href={s.href}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              minHeight: 52, padding: "0 18px", borderRadius: 12, textDecoration: "none",
              border: `1.5px solid ${on ? "var(--accent)" : "transparent"}`,
              background: on ? "var(--accent-soft)" : "transparent",
              color: on ? "var(--accent)" : "var(--sub)",
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICON[s.href]}</svg>
            <span style={{ fontSize: 14.5, fontWeight: on ? 800 : 700 }}>{s.label}</span>
          </Link>
        );
      })}
      <div style={{ flex: 1 }} />
      {/* 잘못 들어온 경우의 탈출구 — 폰/PC 사용자가 태블릿 화면에 갇히지 않도록 항상 노출.
          누르면 이 기기를 다시 "폰" 화면으로 기억한다(재진입 시 배너·자동전환 없음). */}
      <button
        onClick={() => { setDeviceMode("phone"); window.location.href = TABLET_TO_PHONE[current]; }}
        title="이 화면 그만 쓰기"
        style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, minHeight: 52, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--faint)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" /><path d="M10 12h11m0 0-4-4m4 4-4 4" /></svg>
        일반 화면
      </button>
    </div>
  );
}
