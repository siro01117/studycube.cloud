"use client";

// 폰 전용 화면들의 좌상단 메뉴 — 뒤로가기 대신 이걸 눌러 화면을 오간다.
// (폰에서 쓰는 화면: 대시보드 / 공지 / 좌석 / 순찰 / 순찰 기록 / 벌점)
// 대시보드(/home)는 폰 전용 화면이 아니라 전 직원의 첫 화면이다 — 이 다섯 화면에서 돌아갈 길이
// 여기 말고는 없어서(좌측 레일은 폰에서 숨는다) 목록 맨 위에 둔다.
// 세로 시트 목록이라(하단 탭바 아님) 4→5개로 늘어도 가로 폭 문제는 없다 — 항목 높이(60px)만큼
// 시트가 한 줄 길어질 뿐, globals.css 의 폰 하단 탭 규칙(.nav-rail 등, /m/* 포털 전용)과는 무관하다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { getUnreadNoticeCount } from "../m/notice/actions";

// /notice 화면이 공지를 읽음 처리한 직후 이 이벤트를 쏴서 메뉴 배지를 즉시 갱신시킨다.
export const NOTICE_READ_EVENT = "sc:notice-read";

export const MOBILE_SCREENS = [
  { href: "/home", label: "대시보드", desc: "지금 원 안의 상황" },
  { href: "/notice", label: "공지사항", desc: "원장·실장 공지 확인" },
  { href: "/seat", label: "좌석 배치도", desc: "누가 어디 · 입퇴실" },
  { href: "/patrol", label: "순찰", desc: "돌면서 상태 기록" },
  { href: "/records", label: "순찰 기록", desc: "지난 순찰 확인·정정" },
  { href: "/penalty", label: "벌점", desc: "이번 주 누적·부여" },
] as const;

const ICON: Record<string, React.ReactNode> = {
  "/home": <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  "/notice": <><path d="M4 4h13l3 3v13H4z" /><path d="M8 9h9M8 13h9M8 17h5" /></>,
  "/seat": <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  "/patrol": <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  "/records": <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  "/penalty": <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
};

export default function MobileNav({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  // 안 읽은 공지 수 — 화면(좌석/순찰/기록/벌점/공지) 어디서나 이 메뉴 버튼에 배지로 뜬다.
  // 서버 prop 을 5개 화면 전부에 꿰지 않고 이 컴포넌트가 직접 조회(서버 액션 직접 호출 —
  // MobilePenalty 의 getStudentPenaltyWeek 호출과 같은 기존 패턴).
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => getUnreadNoticeCount().then((n) => { if (alive) setUnread(n); }).catch(() => {});
    refresh();
    // 화면 이동뿐 아니라 "지금 이 화면에서" 공지를 읽어도 즉시 줄어야 한다 — /notice 화면(같은
    // current 라 위 refresh 만으론 재조회가 안 걸림)이 읽음 처리할 때 이 이벤트를 쏴서 갱신한다.
    window.addEventListener(NOTICE_READ_EVENT, refresh);
    return () => { alive = false; window.removeEventListener(NOTICE_READ_EVENT, refresh); };
  }, [current]); // 화면을 옮길 때마다도 다시 조회(공지를 읽고 돌아왔을 수 있음)

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={unread > 0 ? `메뉴 · 안 읽은 공지 ${unread}건` : "메뉴"}
        style={{ position: "relative", width: 40, height: 40, border: "none", background: "transparent", color: "var(--sub)", display: "grid", placeItems: "center", cursor: "pointer", flex: "none" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        {unread > 0 && (
          <span aria-hidden style={{
            position: "absolute", top: 3, right: 3, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8,
            background: "var(--danger-strong)", color: "#fff", fontSize: 9.5, fontWeight: 800,
            display: "grid", placeItems: "center", lineHeight: 1,
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 60 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 61, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "16px 14px calc(14px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12, padding: "0 2px" }}>
              <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>화면 이동</span>
              <button onClick={() => setOpen(false)} aria-label="닫기"
                style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--sub)", fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MOBILE_SCREENS.map((s) => {
                const on = s.href === current;
                return (
                  <Link key={s.href} href={s.href} onClick={() => setOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 14px",
                      borderRadius: 14, textDecoration: "none",
                      border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                      background: on ? "var(--accent-soft)" : "var(--bg)",
                    }}>
                    <span style={{ width: 38, height: 38, borderRadius: 11, background: on ? "var(--accent)" : "var(--panel2)", color: on ? "#fff" : "var(--sub)", display: "grid", placeItems: "center", flex: "none" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[s.href]}</svg>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: on ? 800 : 700, color: on ? "var(--accent)" : "var(--ink)" }}>{s.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--faint)" }}>{s.desc}</span>
                    </span>
                    {s.href === "/notice" && unread > 0 && (
                      <span style={{
                        flex: "none", minWidth: 20, height: 20, padding: "0 5px", borderRadius: 10,
                        background: "var(--danger-strong)", color: "#fff", fontSize: 11, fontWeight: 800,
                        display: "grid", placeItems: "center",
                      }}>
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                    {on && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)" }}>현재</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
