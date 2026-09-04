"use client";

import Link from "next/link";

// 허브(공개 폼 선택 화면)의 "잠긴 항목" 공용 처리 — HubCard 가 이유를 몰라도(그냥 문자열 배열만 받아서)
// 팝업으로 보여줄 수 있게 한다. 지금은 두 갈래가 이 컴포넌트를 함께 쓴다:
//  1) 항상 준비 중인 항목(registry.ts open:false, 예: 도시락) — 고정 문구.
//  2) 지금은 열려 있다가도 상황에 따라 잠기는 항목(스케쥴 입력, resolveEditState 기반) — 동적 문구.
// 앞으로 잠기는 항목이 늘어나도 "문자열 배열 + 팝업"이라는 모양만 맞추면 이 컴포넌트를 그대로 쓸 수 있다.

/** 준비 중(registry open:false)인 항목 공통 안내. */
export const GENERIC_LOCKED_LINES = ["아직 준비되지 않았어요.", "급하면 카운터에 말씀해 주세요."];

export function LockPopup({ title, lines, onClose }: { title: string; lines: string[]; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,22,30,.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360, borderRadius: 16, background: "var(--card)", border: "1px solid var(--line)",
          boxShadow: "0 20px 48px rgba(20,22,30,.24)", padding: "22px 20px 18px", textAlign: "center",
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--panel2)", color: "var(--dim)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <LockGlyph />
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontSize: 13.5, color: "var(--dim)", lineHeight: 1.5 }}>{line}</div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-accent"
          style={{ width: "100%", height: 44, fontSize: 14, fontWeight: 700 }}
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// LockPopup 과 같은 모양(문구 + 버튼 팝업)을 쓰되, "잠김"이 아니라 "지금은 뭔가 할 수 있어요"를
// 알리는 반대 톤 — 아이콘·색을 dim/lock 대신 accent/calendar 로 바꿨다. actionHref 를 주면 "확인했어요"
// 위에 강조 버튼(바로가기)이 하나 더 붙는다(예: 스케쥴 입력 화면으로).
export function InfoPopup({
  title, lines, actionHref, actionLabel, onClose,
}: {
  title: string;
  lines: string[];
  actionHref?: string;
  actionLabel?: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,22,30,.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360, borderRadius: 16, background: "var(--card)", border: "1px solid var(--line)",
          boxShadow: "0 20px 48px rgba(20,22,30,.24)", padding: "22px 20px 18px", textAlign: "center",
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <CalendarGlyph />
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontSize: 13.5, color: "var(--dim)", lineHeight: 1.5 }}>{line}</div>
          ))}
        </div>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="btn btn-accent"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: 44, fontSize: 14, fontWeight: 700, marginBottom: 8, textDecoration: "none" }}
          >
            {actionLabel}
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%", height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, cursor: "pointer",
            border: "1px solid var(--line)", background: "var(--panel2)", color: "var(--sub)",
          }}
        >
          나중에 할게요
        </button>
      </div>
    </div>
  );
}

function CalendarGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M8 2.5v3M16 2.5v3" />
    </svg>
  );
}
