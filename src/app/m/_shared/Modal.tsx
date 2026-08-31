import type { CSSProperties, ReactNode } from "react";

// m/** 여러 화면이 손으로 반복하던 "position:fixed;inset:0 백드롭 + 가운데 고정 패널" 뼈대를 공용화.
// 패널 자체의 스타일(배경/테두리/둥글기/그림자/패딩/overflow 등)은 화면마다 실제로 달라서
// panelStyle 로 그대로 넘긴다 — 값을 정규화하지 않고 각 호출부의 기존 값을 그대로 옮긴다.
// 스타일은 longhand 속성만 사용한다(축약형 border/background 와 조건부 개별 속성 혼용 시 렌더 깨짐 이력).
export default function Modal({
  onClose,
  backdropBackground,
  backdropZIndex,
  panelZIndex,
  panelStyle,
  children,
}: {
  onClose: () => void;
  backdropBackground: string;
  backdropZIndex: number;
  panelZIndex: number;
  panelStyle: CSSProperties;
  children: ReactNode;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: backdropBackground, zIndex: backdropZIndex }}
      />
      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: panelZIndex,
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </>
  );
}
