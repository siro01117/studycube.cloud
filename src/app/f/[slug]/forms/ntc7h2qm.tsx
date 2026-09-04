"use client";

// 학생용 공지사항(ntc7h2qm) — 안 읽은 공지가 위로, 중요 공지는 안 읽었으면 눈에 띄게. 열면 읽음 처리.
// 직원 폰 화면(src/app/notice/MobileNotice.tsx)과 같은 발상이지만, 그건 로그인 세션(person) 기반
// 전용 페이지라 그대로 재사용할 수 없다 — 여기는 공개 폼이라 신원 가드·loading/expired 스위치를
// 공용 셸(ReadOnlyInfoShell)에 맡기고, 목록+상세 시트만 이 파일에서 다시 그린다.
import { useEffect, useState } from "react";
import ReadOnlyInfoShell from "../../_shared/ReadOnlyInfoShell";
import { useIdentity } from "../../_shared/useIdentity";
import type { FormDef } from "../../registry";
import { getMyNotices, markMyNoticeRead, type MyNoticeListResult, type MyNoticeRow } from "./notice-actions";
import NoticeGallery from "../../../m/notice/NoticeGallery";

const ImportantIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", flex: "none" }}>
    <path d="M10 2 3 16h14L10 2z" /><path d="M10 8v4M10 14h.01" />
  </svg>
);

export default function MyNotice({ def }: { def: FormDef }) {
  return (
    <ReadOnlyInfoShell<Extract<MyNoticeListResult, { ok: true }>>
      def={def}
      fetchResult={getMyNotices}
      noDataText="실제 학생 코드로 확인하면 학원 공지를 볼 수 있어요."
    >
      {(result) => <NoticeContent notices={result.notices} />}
    </ReadOnlyInfoShell>
  );
}

function NoticeContent({ notices: initial }: { notices: MyNoticeRow[] }) {
  const { identity } = useIdentity();
  const [notices, setNotices] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setNotices(initial), [initial]);

  const open = notices.find((n) => n.id === openId) ?? null;

  const openNotice = (n: MyNoticeRow) => {
    setOpenId(n.id);
    if (n.isRead || !identity) return;
    setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    const fd = new FormData();
    fd.set("id", n.id);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    markMyNoticeRead(fd);
  };

  if (notices.length === 0) {
    return <div style={{ fontSize: 15, color: "var(--dim)", textAlign: "center", padding: "24px 4px" }}>등록된 공지가 없어요.</div>;
  }

  return (
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

      {open && (
        <>
          <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 70 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 71, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", maxHeight: "86dvh", overflowY: "auto" }}>
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
    </div>
  );
}
