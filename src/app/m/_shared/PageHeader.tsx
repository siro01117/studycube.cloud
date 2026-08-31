import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// m/** 페이지들이 복붙하던 상단 헤더 셸(뒤로가기 링크 + 타이틀 + 우측 영역) 공용화.
// 페이지마다 실제로 달랐던 부분(뒤로가기 라벨/링크 스타일, max-w 래퍼 유무, header 의
// flex:"none" 유무, 타이틀 옆 추가 요소, 우측 영역 전체 마크업)은 전부 prop 으로 그대로 흡수한다 —
// 동작·픽셀을 하나도 바꾸지 않기 위해 값을 정규화하지 않는다.
export default function PageHeader({
  backHref,
  backLabel,
  backLinkStyle = { textDecoration: "none" },
  title,
  titleExtra,
  right,
  maxWidth = false,
  flexNone = false,
}: {
  backHref: string;
  backLabel: string;
  backLinkStyle?: CSSProperties;
  title: string;
  titleExtra?: ReactNode;
  right?: ReactNode;
  maxWidth?: boolean;
  flexNone?: boolean;
}) {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
        ...(flexNone ? { flex: "none" } : {}),
      }}
    >
      <div
        className={
          (maxWidth ? "mx-auto max-w-[1080px] " : "") + "px-5 h-14 flex items-center justify-between"
        }
      >
        <div className="flex items-center gap-3">
          <Link href={backHref} className="chip" style={backLinkStyle}>
            ‹ {backLabel}
          </Link>
          <span style={{ fontWeight: 700 }}>{title}</span>
          {titleExtra}
        </div>
        {right}
      </div>
    </header>
  );
}
