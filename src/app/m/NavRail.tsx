"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../home/actions";

export type NavModule = { key: string; label: string; href: string | null };

export default function NavRail({ modules, me }: { modules: NavModule[]; me: { name: string; isCto: boolean } }) {
  const path = usePathname();

  return (
    <nav style={S.rail}>
      <div style={S.brand} title="StudyCube">SC</div>

      <div style={S.list}>
        {modules.map((m) => {
          const ready = !!m.href;
          const active = ready && (path === m.href || path.startsWith(m.href + "/"));
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
          return ready ? (
            <Link key={m.key} href={m.href!} style={S.item} title={m.label}>
              {body}
            </Link>
          ) : (
            <div key={m.key} style={{ ...S.item, opacity: 0.4, cursor: "default" }} title={`${m.label} · 준비중`}>
              {body}
            </div>
          );
        })}
      </div>

      <div style={S.foot}>
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
  },
  list: { display: "flex", flexDirection: "column", gap: 2, width: "100%", alignItems: "center", overflowY: "auto", flex: 1 },
  item: {
    width: 66, padding: "7px 0", borderRadius: 12, textDecoration: "none", color: "var(--sub)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
  },
  icoBox: { width: 40, height: 34, borderRadius: 10, display: "grid", placeItems: "center", color: "var(--sub)" },
  icoOn: { background: "var(--accent-soft)", color: "var(--accent)" },
  lbl: { fontSize: 10.5, lineHeight: 1.15, textAlign: "center", color: "var(--faint)", maxWidth: 68 },
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
