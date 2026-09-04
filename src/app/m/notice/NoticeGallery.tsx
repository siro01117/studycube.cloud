"use client";

// 공지 사진 여러 장 표시(가로 스크롤 스냅) + 눌러서 크게 보기(공용 Modal 재사용 — Esc·포커스 가둠은
// Modal이 이미 처리). 관리 화면(m/notice)·직원 폰(/notice)·학생 폼(f/[slug]/forms/ntc7h2qm) 셋이
// 그대로 같이 쓴다 — 새 라이브러리 없이 CSS scroll-snap-type 만으로 충분하다고 판단(집주인 지시:
// 판단해서 근거를 남길 것 — 사진이 최대 6장이라 캐러셀 라이브러리 없이도 매끈하다).
import { useState } from "react";
import Modal from "../_shared/Modal";

export type NoticeImageRef = { id: string };

const ChevronIcon = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 16 16" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d={dir === "left" ? "M10 3.5l-5 4.5 5 4.5" : "M6 3.5l5 4.5-5 4.5"} />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export default function NoticeGallery({ images, title }: { images: NoticeImageRef[]; title: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div
        style={{
          display: "flex", gap: 8, marginTop: 10, overflowX: "auto",
          scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch",
        }}
      >
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpenIdx(i)}
            style={{
              flex: "none", width: images.length > 1 ? "min(78%, 320px)" : "100%", maxWidth: 480,
              aspectRatio: "4 / 3", scrollSnapAlign: "start", borderRadius: 12, overflow: "hidden",
              border: "1px solid var(--line)", padding: 0, cursor: "zoom-in", background: "var(--panel2)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 서버 라우트(/api/notice-image)가 캐시 헤더를 붙여 직접 서빙, next/image 최적화 대상 아님 */}
            <img
              src={`/api/notice-image/${img.id}`}
              alt={`${title} 첨부 사진 ${i + 1}/${images.length}`}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </button>
        ))}
      </div>

      {openIdx !== null && (
        <Modal
          onClose={() => setOpenIdx(null)}
          backdropBackground="rgba(10,12,18,.86)"
          backdropZIndex={90}
          panelZIndex={91}
          ariaLabel={`${title} 사진 크게 보기`}
          panelStyle={{
            width: "min(94vw, 920px)", maxHeight: "90dvh", background: "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/notice-image/${images[openIdx].id}`}
            alt={`${title} 사진 ${openIdx + 1}/${images.length}`}
            style={{ maxWidth: "100%", maxHeight: "76dvh", borderRadius: 14, objectFit: "contain" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {images.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenIdx((openIdx - 1 + images.length) % images.length)}
                aria-label="이전 사진"
                style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.1)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <ChevronIcon dir="left" />
              </button>
            )}
            <span style={{ color: "#fff", fontSize: 12.5, minWidth: 44, textAlign: "center" }}>{openIdx + 1} / {images.length}</span>
            {images.length > 1 && (
              <button
                type="button"
                onClick={() => setOpenIdx((openIdx + 1) % images.length)}
                aria-label="다음 사진"
                style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.1)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <ChevronIcon dir="right" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpenIdx(null)}
              aria-label="닫기"
              style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid rgba(255,255,255,.3)", background: "rgba(255,255,255,.1)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginLeft: 8 }}
            >
              <CloseIcon />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
