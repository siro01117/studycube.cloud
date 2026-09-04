"use client";

// 학생 상세 팝업(StudentPopup)의 "벌점" 버튼을 누르면 뜨는 사이드 패널.
// 집주인이 지정한 상호작용: 팝업 안에 벌점 내역을 붙이지 않고, 팝업이 왼쪽으로 살짝 밀려나면서
// 오른쪽에 별도 패널이 뜬다. 실제 벌점 부여·조회·삭제·추이는 PenaltyDetailPanel(공용) 이 담당하고,
// 이 컴포넌트는 "어디에 어떻게 뜨는가"만 맡는다.
//
// 데스크톱(넓은 화면)에서는 팝업이 담긴 Modal 다이얼로그 DOM 을 직접 찾아 옆으로 밀고, 그 오른쪽에
// 이 패널을 띄운다 — 팝업을 감싼 Modal(StudentList 화면 등)을 건드리지 않고도 동작해야 해서(다른
// 작업이 그 파일들을 편집 중) DOM 을 직접 측정하는 방식을 택했다.
// 폰처럼 옆으로 밀 자리가 없는 화면(대략 900px 미만)에서는 밀어내지 않고 이 패널이 화면 아래에서
// 올라오는 전체 폭 시트로 대체된다 — 옆에 나란히 두면 둘 다 반 토막 나 읽을 수 없어지기 때문.
import { useEffect, useRef, useState, type RefObject } from "react";
import { pushModalLayer, popModalLayer, isTopModalLayer, FOCUSABLE } from "./Modal";
import PenaltyDetailPanel from "./PenaltyDetailPanel";

const SIDE_WIDTH = 340;
const GAP = 16;
const SHIFT = (SIDE_WIDTH + GAP) / 2; // 팝업을 이만큼 왼쪽으로 밀어 패널과 짝을 이룬 채로 다시 중앙 정렬
const SIDE_BY_SIDE_MIN = 900; // 이 아래는 옆에 펼 자리가 없다(폰 포함) → 전체 폭 시트로 대체

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export default function PenaltySidePanel({
  open, onClose, triggerRef, studentId, studentName, canManage, canPatrolManage, today, weekStart,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>; // "벌점" 버튼 — 다이얼로그 탐색 기준점 + 닫을 때 포커스 복귀 대상
  studentId: string;
  studentName: string;
  canManage: boolean;
  canPatrolManage: boolean;
  today: string;
  weekStart: string;
}) {
  const [sideBySide, setSideBySide] = useState(true);
  const [pos, setPos] = useState<{ left: number; top: number; height: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // PenaltyDetailPanel 안의 "벌점 주기" 메뉴 — 열려 있는 동안은 Esc 를 이 패널이 가로채지 않는다(메뉴가 먼저 닫혀야 한다)
  const panelRef = useRef<HTMLDivElement>(null);
  const layerId = useRef<symbol | null>(null);

  // 열림/리사이즈 시: 옆으로 펼 자리 판정 + 다이얼로그를 왼쪽으로 밀고 그 실측 위치로 패널을 앉힌다.
  useEffect(() => {
    if (!open) return;
    const dialog = triggerRef.current?.closest('[role="dialog"]') as HTMLElement | null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const apply = () => {
      const wide = window.innerWidth >= SIDE_BY_SIDE_MIN;
      setSideBySide(wide);
      if (!dialog) return;
      dialog.style.transition = reduced ? "none" : "transform 160ms ease";
      if (wide) {
        const rect = dialog.getBoundingClientRect(); // 밀기 전 실측 — 여기서 목표 위치를 산수로 구한다
        dialog.style.transform = `translate(calc(-50% - ${SHIFT}px), -50%)`;
        setPos({ left: rect.right - SHIFT + GAP, top: rect.top, height: rect.height });
      } else {
        dialog.style.transform = "translate(-50%, -50%)";
        setPos(null);
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      if (dialog) dialog.style.transform = "translate(-50%, -50%)";
    };
  }, [open, triggerRef]);

  // 열림/닫힘에 따라 이 레이어를 Modal 스택에 올리고 내린다 — 그래야 Esc 가 "지금 맨 위" 레이어(이
  // 패널)에만 반응하고, 밑에 깔린 팝업의 Modal 은 반응하지 않는다(둘 다 window keydown 을 듣기 때문).
  useEffect(() => {
    if (!open) return;
    const id = pushModalLayer();
    layerId.current = id;
    const prevFocused = document.activeElement as HTMLElement | null;
    // 패널 안 첫 포커스 가능 요소로(없으면 패널 컨테이너 자체로) 포커스 이동
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopModalLayer(id)) return;
      if (menuOpen) return; // 메뉴가 열려 있으면 그쪽 자체 Esc 핸들러가 먼저 닫게 둔다
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === panel) { e.preventDefault(); last.focus(); }
      } else if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      popModalLayer(id);
      // StudentPopup 의 "벌점" 버튼으로 포커스 복귀 — Modal 이 팝업 자체를 닫을 때 하는 복귀와 같은 원칙.
      (prevFocused ?? triggerRef.current)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, menuOpen]);

  // 바깥(투명 배경) 클릭 시 닫기 — 옆에 있는 팝업을 눌러도 이 패널부터 닫힌다(흔한 플라이아웃 동작).
  const backdrop = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 57 }} />
  );

  if (!open) return null;

  if (!sideBySide) {
    // 폰 등 옆에 펼 자리가 없는 화면 — 화면 아래에서 올라오는 전체 폭 시트로 대체.
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,22,30,.45)", zIndex: 57 }} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${studentName} 벌점`}
          tabIndex={-1}
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 58, maxHeight: "80dvh", overflowY: "auto",
            background: "var(--panel)", border: "1px solid var(--line)", borderTop: "1px solid var(--line)",
            borderRadius: "20px 20px 0 0", boxShadow: "0 -12px 40px rgba(20,22,30,.28)",
            padding: "18px 20px calc(20px + env(safe-area-inset-bottom))", outline: "none",
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>{studentName} · 벌점</span>
            <button onClick={onClose} aria-label="벌점 패널 닫기" className="chip" style={{ height: 28, width: 28, padding: 0, justifyContent: "center", cursor: "pointer" }}><CloseIcon /></button>
          </div>
          <PenaltyDetailPanel
            studentId={studentId} canManage={canManage} canPatrolManage={canPatrolManage}
            today={today} weekStart={weekStart} onMenuOpenChange={setMenuOpen}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {backdrop}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${studentName} 벌점`}
        tabIndex={-1}
        style={{
          position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, width: SIDE_WIDTH,
          maxHeight: pos ? pos.height : undefined, overflowY: "auto",
          zIndex: 58, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
          boxShadow: "0 24px 70px rgba(20,22,30,.35)", padding: 18, outline: "none",
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{studentName} · 벌점</span>
          <button onClick={onClose} aria-label="벌점 패널 닫기" className="chip" style={{ height: 26, width: 26, padding: 0, justifyContent: "center", cursor: "pointer" }}><CloseIcon /></button>
        </div>
        <PenaltyDetailPanel
          studentId={studentId} canManage={canManage} canPatrolManage={canPatrolManage}
          today={today} weekStart={weekStart} onMenuOpenChange={setMenuOpen}
        />
      </div>
    </>
  );
}
