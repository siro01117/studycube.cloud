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

// 중첩 Modal(예: 학생 상세 팝업 위에 뜨는 벌점 사이드 패널) 지원용 스택. 각 인스턴스가 마운트 시
// 자기 id 를 넣고 언마운트 시 뺀다. Esc·Tab 트랩은 "지금 스택 맨 위(가장 나중에 열린 것)"인 인스턴스만
// 반응한다 — 이게 없으면 중첩된 두 Modal 이 같은 Esc 한 번에 동시에 닫혀 버린다(둘 다 window 의
// keydown 을 버블 단계에서 듣기 때문). 모듈 스코프 배열이라 페이지 전역에서 공유된다.
const modalStack: symbol[] = [];

// 위 스택을 Modal 이 아닌 다른 "떠 있는 레이어"(예: 사이드 패널 — 가운데 정렬이 아니라 옆에 붙어야
// 해서 Modal 컴포넌트 자체를 못 쓰는 경우)도 같은 규칙으로 줄 세우고 싶을 때 쓰는 export.
export function pushModalLayer(): symbol {
  const id = Symbol();
  modalStack.push(id);
  return id;
}
export function popModalLayer(id: symbol) {
  const i = modalStack.indexOf(id);
  if (i !== -1) modalStack.splice(i, 1);
}
export function isTopModalLayer(id: symbol): boolean {
  return modalStack[modalStack.length - 1] === id;
}
export { FOCUSABLE };

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
  const idRef = useRef<symbol>(Symbol());

  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    modalStack.push(idRef.current);

    const isTop = () => modalStack[modalStack.length - 1] === idRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return; // 이 Modal 위에 더 나중에 열린 Modal 이 있으면 그쪽이 먼저 반응한다
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
      const i = modalStack.indexOf(idRef.current);
      if (i !== -1) modalStack.splice(i, 1);
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
