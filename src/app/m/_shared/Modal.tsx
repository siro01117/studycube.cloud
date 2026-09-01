import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// m/** 여러 화면이 손으로 반복하던 "position:fixed;inset:0 백드롭 + 가운데 고정 패널" 뼈대를 공용화.
// 패널 자체의 스타일(배경/테두리/둥글기/그림자/패딩/overflow 등)은 화면마다 실제로 달라서
// panelStyle 로 그대로 넘긴다 — 값을 정규화하지 않고 각 호출부의 기존 값을 그대로 옮긴다.
// 스타일은 longhand 속성만 사용한다(축약형 border/background 와 조건부 개별 속성 혼용 시 렌더 깨짐 이력).
//
// 접근성(a11y) 관련 prop 은 전부 선택값 + 기본 동작으로 추가되어 기존 호출부는 그대로 컴파일·동작한다:
// role="dialog"/aria-modal 은 항상 붙이고, ariaLabel/ariaLabelledBy 는 넘긴 것만 반영한다.
// 마운트 시 패널로 포커스 이동 + 언마운트 시 이전 포커스 복원, Esc 로 닫기, 패널 안에서 Tab 트랩까지
// 전부 이 컴포넌트 안에서 처리하므로 화면마다 따로 구현할 필요가 없다.
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  onClose,
  backdropBackground,
  backdropZIndex,
  panelZIndex,
  panelStyle,
  children,
  ariaLabel,
  ariaLabelledBy,
}: {
  onClose: () => void;
  backdropBackground: string;
  backdropZIndex: number;
  panelZIndex: number;
  panelStyle: CSSProperties;
  children: ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      prevFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: backdropBackground, zIndex: backdropZIndex }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: panelZIndex,
          outline: "none",
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </>
  );
}
