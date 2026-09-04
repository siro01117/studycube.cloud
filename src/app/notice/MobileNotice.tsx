"use client";

// 폰용 공지 — 안 읽은 공지가 위로, 중요 공지는 안 읽었으면 눈에 띄게. 열면 읽음 처리.
import { useState, useTransition } from "react";
import MobileNav, { NOTICE_READ_EVENT } from "../_shared/MobileNav";
import { markNoticeRead } from "../m/notice/actions";
import NoticeGallery, { type NoticeImageRef } from "../m/notice/NoticeGallery";

export type MNotice = {
  id: string; title: string; body: string; important: boolean;
  authorName: string; createdLabel: string; isRead: boolean; images: NoticeImageRef[];
};

const ImportantIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", flex: "none" }}>
    <path d="M10 2 3 16h14L10 2z" /><path d="M10 8v4M10 14h.01" />
  </svg>
);

export default function MobileNotice({ notices: initial }: { notices: MNotice[] }) {
  const [notices, setNotices] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, start] = useTransition();

  const unreadCount = notices.filter((n) => !n.isRead).length;
  const open = notices.find((n) => n.id === openId) ?? null;

  const openNotice = (n: MNotice) => {
    setOpenId(n.id);
    if (n.isRead) return;
    setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    const fd = new FormData();
    fd.set("id", n.id);
    start(async () => {
      await markNoticeRead(fd);
      window.dispatchEvent(new Event(NOTICE_READ_EVENT)); // 메뉴 배지(MobileNav) 즉시 갱신
    });
  };

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <MobileNav current="/notice" />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>공지사항</div>
          <div style={{ fontSize: 11, color: "var(--faint)" }}>{unreadCount > 0 ? `안 읽은 공지 ${unreadCount}건` : "모두 읽었습니다"}</div>
        </div>
        <span style={{ width: 40, flex: "none" }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px calc(16px + env(safe-area-inset-bottom))" }}>
        {notices.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13.5, padding: 40 }}>등록된 공지가 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {notices.map((n) => {
              const unreadImportant = n.important && !n.isRead;
              const cover = n.images[0];
              return (
                <button
                  key={n.id}
                  onClick={() => openNotice(n)}
                  style={{
                    textAlign: "left", cursor: "pointer", borderRadius: 16, padding: 0, overflow: "hidden",
                    border: `1px solid ${unreadImportant ? "var(--danger-strong)" : "var(--line)"}`,
                    background: "var(--card)", display: "flex", flexDirection: "column",
                  }}
                >
                  {!n.isRead && (
                    <span aria-hidden style={{ display: "block", height: 3, background: unreadImportant ? "var(--danger-strong)" : "linear-gradient(90deg, var(--accent), #a855f7)" }} />
                  )}
                  <div style={{ display: "flex", gap: 10, padding: "12px 14px" }}>
                    {cover && (
                      <div style={{ flex: "none", width: 56, height: 56, borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/notice-image/${cover.id}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {n.important && <span style={{ color: "var(--danger-strong)", display: "flex", flex: "none" }}><ImportantIcon /></span>}
                        <span style={{ fontSize: 15.5, fontWeight: n.isRead ? 600 : 800, color: n.isRead ? "var(--sub)" : "var(--ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {n.title}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--faint)" }}>{n.authorName} · {n.createdLabel}</div>
                      {n.images.length > 1 && (
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>사진 {n.images.length}장</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <>
          <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", maxHeight: "86dvh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {open.important && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--danger-strong)", fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                    <ImportantIcon /> 중요
                  </div>
                )}
                <div style={{ fontSize: 18, fontWeight: 800 }}>{open.title}</div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{open.authorName} · {open.createdLabel}</div>
              </div>
              <button onClick={() => setOpenId(null)} aria-label="닫기" style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--sub)", fontSize: 16, cursor: "pointer", flex: "none" }}>✕</button>
            </div>
            <div style={{ fontSize: 14.5, color: "var(--ink)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
              {open.body}
            </div>
            <NoticeGallery images={open.images} title={open.title} />
          </div>
        </>
      )}
    </main>
  );
}
