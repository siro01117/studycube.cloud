"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../home/actions";
import { MODULES, type ModuleCategory } from "@/lib/modules";

export type NavModule = { key: string; label: string; href: string | null };

// 폰 하단 탭에 직접 노출할 개수(나머지는 '더보기' 시트).
// Material·Apple HIG 모두 하단 탭 3~5개 권장 — 여기서는 4 + 더보기 = 5.
const PRIMARY_TABS = 4;

// key → category 조회(정적 카탈로그, DB 왕복 없음). 카탈로그에 없는 키(이론상 없음)는 묶음 없이 표시.
const CATEGORY_OF = new Map(MODULES.map((m) => [m.key, m.category]));
const CATEGORY_ORDER: ModuleCategory[] = ["student", "today", "staff"];

// modules 를 카테고리 순서대로 묶는다 — 그 카테고리에 속한 모듈이 하나도 없으면(지점이 안 켰거나
// 권한이 없어 layout.tsx 가 이미 걸러낸 경우) 묶음 자체를 만들지 않는다(빈 묶음 숨김).
function groupByCategory(modules: NavModule[]): { category: ModuleCategory; items: NavModule[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: modules.filter((m) => (CATEGORY_OF.get(m.key) ?? "staff") === category),
  })).filter((g) => g.items.length > 0);
}

export default function NavRail({ modules, me }: { modules: NavModule[]; me: { name: string; isCto: boolean } }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  // 화면이 없는(href 없음) 모듈은 메뉴에서 아예 뺀다 — DESIGN.md §5: "못 여는 문을 그려 두면
  // 메뉴가 산발적으로 보인다." MODULES 카탈로그에는 그대로 남아 있으니(권한 판정용), 화면이 생기면
  // src/lib/modules.ts 의 MODULE_ROUTES 에 경로 한 줄만 추가하면 다시 뜬다.
  const readyModules = modules.filter((m) => m.href);
  const primaryKeys = new Set(readyModules.slice(0, PRIMARY_TABS).map((m) => m.key));
  const groups = groupByCategory(readyModules);
  const moreGroups = groupByCategory(readyModules.filter((m) => !primaryKeys.has(m.key)));

  const renderItem = (m: NavModule) => {
    const active = path === m.href || path.startsWith(m.href + "/");
    const body: ReactNode = (
      <>
        <span style={{ ...S.icoBox, ...(active ? S.icoOn : null) }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {ICON[m.key] ?? ICON._default}
          </svg>
        </span>
        <span style={{ ...S.lbl, ...(active ? { color: "var(--accent)", fontWeight: 700 } : null) }}>{m.label}</span>
      </>
    );
    return (
      <Link key={m.key} className="rail-item" data-primary={primaryKeys.has(m.key) ? "1" : "0"} href={m.href!} style={S.item} title={m.label}>
        {body}
      </Link>
    );
  };

  return (
    <nav className="nav-rail" style={S.rail}>
      {/* 어느 화면에서든 홈으로 한 번에 — DESIGN.md §8. 레일 맨 위 로고가 그 자리. */}
      <Link href="/home" className="rail-brand" style={S.brand} title="대시보드로" aria-label="대시보드로">SC</Link>

      <div className="rail-list" style={S.list}>
        {/* DESIGN.md §5: 묶음은 이름이 아니라 구분선으로. 카테고리 제목 글자 대신 구분선 하나로 무리를
            나눈다(첫 묶음 앞에는 안 그린다). 데스크탑에서만 보인다(rail-group-sep 은 폰 폭에서 CSS로
            숨김 — globals.css 참고). 빈 묶음은 groupByCategory 가 이미 걸러내므로 구분선이 겹칠 일은 없다.
            폰 하단 탭은 카테고리와 무관하게 항상 평평한 한 줄(기존 구조 유지, 주석 위 PRIMARY_TABS 참고). */}
        {groups.map((g, i) => (
          <div key={g.category} className="rail-group" style={{ display: "contents" }}>
            {i > 0 && <div className="rail-group-sep" style={S.groupSep} />}
            {g.items.map(renderItem)}
          </div>
        ))}

        {/* 폰 전용 5번째 탭 — 나머지 모듈·로그아웃 */}
        <button className="rail-more" onClick={() => setMore(true)} style={{ ...S.item, border: "none", background: "transparent", cursor: "pointer" }}>
          <span style={S.icoBox}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
            </svg>
          </span>
          <span style={S.lbl}>더보기</span>
        </button>
      </div>

      {/* 더보기 시트 (폰) */}
      {more && (
        <>
          <div onClick={() => setMore(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))", maxHeight: "76dvh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={S.avatar}>{me.name.slice(0, 1)}</span>
              <span style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>{me.name}</span>
              <button onClick={() => setMore(false)} style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--sub)", fontSize: 17, cursor: "pointer" }}>✕</button>
            </div>

            {/* 폰에선 레일 로고(대시보드로 돌아가는 길)가 display:none 이라 여기 자리를 만든다 —
                더보기 시트가 폰에서 유일하게 항상 열 수 있는 전역 메뉴라 여기가 맞는 자리(집주인 지시). */}
            <Link href="/home" onClick={() => setMore(false)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginBottom: 14, borderRadius: 14, border: "1px solid var(--line)", background: "var(--bg)", textDecoration: "none", color: "var(--ink)" }}>
              <span style={{ ...S.icoBox, width: 40, height: 36, background: "var(--accent-soft)", color: "var(--accent)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
              </span>
              <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1 }}>대시보드</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--faint)" }}><path d="M9 6l6 6-6 6" /></svg>
            </Link>

            {/* 더보기 시트도 카테고리별로 묶는다(상위 4개를 뺀 나머지끼리) — DESIGN.md §5 대로
                소제목이 아니라 구분선(첫 묶음 앞은 생략)으로 나눈다. */}
            {moreGroups.map((g, i) => (
              <div key={g.category} style={{ marginBottom: 14 }}>
                {i > 0 && <div style={{ height: 1, background: "var(--line)", margin: "0 2px 14px" }} />}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {g.items.map((m) => {
                    const inner = (
                      <>
                        <span style={{ ...S.icoBox, width: 44, height: 40 }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[m.key] ?? ICON._default}</svg>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sub)" }}>{m.label}</span>
                      </>
                    );
                    const box: CSSProperties = { minHeight: 88, borderRadius: 14, border: "1px solid var(--line)", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, textDecoration: "none" };
                    return m.href
                      ? <Link key={m.key} href={m.href} onClick={() => setMore(false)} style={box}>{inner}</Link>
                      : <div key={m.key} style={{ ...box, opacity: 0.4 }}>{inner}</div>;
                  })}
                </div>
              </div>
            ))}
            <form action={logoutAction} style={{ marginTop: 14 }}>
              <button type="submit" className="btn" style={{ height: 50, width: "100%", fontSize: 15 }}>로그아웃</button>
            </form>
          </div>
        </>
      )}

      <div className="rail-foot" style={S.foot}>
        <div style={S.avatar} title={me.name}>{me.name.slice(0, 1)}</div>
        <form action={logoutAction}>
          <button type="submit" style={S.logout} title="로그아웃">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </form>
      </div>
    </nav>
  );
}

const ICON: Record<string, ReactNode> = {
  // notice / staff_schedule 은 등록이 빠져 있어 둘 다 _default(빈 네모)로 그려졌다 — 메뉴에서
  // 서로 구별이 안 됐다. 공지는 확성기(알린다), 직원 관리는 사원증(사람 + 소속)으로 나눈다.
  // student(사람 둘)와 헷갈리지 않게 직원은 카드 테두리를 가진 형태를 골랐다.
  notice: <><path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></>,
  staff_schedule: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9.5 3V1.6h5V3" /><circle cx="12" cy="10" r="2.2" /><path d="M8.6 17.2a3.6 3.6 0 0 1 6.8 0" /></>,
  student: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>,
  seat: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  attendance: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  patrol: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  penalty: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>,
  schedule: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  payment: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  lunch: <><path d="M3 2v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V2M5 2v20M21 15V2a5 5 0 0 0-3 5v6h3zM18 15v7" /></>,
  grade: <><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>,
  planner: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  counsel: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
  mentor: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 11l-3 3-1.5-1.5" /></>,
  activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
  _default: <><rect x="3" y="3" width="18" height="18" rx="2" /></>,
};

const S: Record<string, CSSProperties> = {
  rail: {
    width: 78, flex: "none", alignSelf: "stretch", position: "sticky", top: 0, height: "100dvh",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    padding: "12px 0", background: "var(--card)", borderRight: "1px solid var(--line)",
  },
  brand: {
    width: 38, height: 38, borderRadius: 11, background: "var(--accent)", color: "#fff",
    display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, letterSpacing: ".02em", marginBottom: 8,
    textDecoration: "none", cursor: "pointer",
  },
  list: { display: "flex", flexDirection: "column", gap: 2, width: "100%", alignItems: "center", overflowY: "auto", flex: 1 },
  item: {
    width: 66, padding: "7px 0", borderRadius: 12, textDecoration: "none", color: "var(--sub)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
  },
  icoBox: { width: 40, height: 34, borderRadius: 10, display: "grid", placeItems: "center", color: "var(--sub)" },
  icoOn: { background: "var(--accent-soft)", color: "var(--accent)" },
  lbl: { fontSize: 10.5, lineHeight: 1.15, textAlign: "center", color: "var(--sub)", maxWidth: 68 },
  groupSep: {
    width: 44, height: 1, background: "var(--line)", margin: "6px 0",
  },
  foot: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 6 },
  avatar: {
    width: 34, height: 34, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)",
    display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14,
  },
  logout: {
    width: 34, height: 34, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)",
    color: "var(--sub)", display: "grid", placeItems: "center", cursor: "pointer",
  },
};
