"use client";

// 공용 "삭제됨 · 실행취소" 토스트. 정책(전체 삭제 UX 통일): 삭제를 원래 내용 그대로 되살릴 수 있으면
// 이 토스트로 즉시 실행 + 5초 실행취소, 연쇄 삭제라 되돌릴 수 없으면 인라인 2단계 확인(StudentList의
// confirmDel 패턴)으로 막는다 — window.confirm() 은 어느 경우에도 쓰지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";

const DURATION_MS = 5000;

type ToastState = { message: string; onUndo: () => void } | null;

export function useUndoToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setToast(null);
  }, []);

  // 토스트가 떠 있는 동안 또 삭제가 일어나면 이전 토스트는 교체한다(쌓지 않음) — 벌점·순찰은
  // 빠르게 연속으로 지우는 일이 흔한데, 여러 개를 쌓아 보여주면 화면을 가리고 "실행취소"가 어느
  // 삭제를 되돌리는지 헷갈린다. 최신 삭제 하나만 되돌릴 수 있으면 충분하다(이전 것은 그대로 남음).
  const notify = useCallback((message: string, onUndo: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, onUndo });
    timerRef.current = setTimeout(dismiss, DURATION_MS);
  }, [dismiss]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const element = toast ? (
    <div
      role="status"
      style={{
        position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 90,
        display: "flex", alignItems: "center", gap: 10,
        background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
        boxShadow: "0 12px 34px rgba(20,22,30,.28)", padding: "8px 8px 8px 16px",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {toast.message}
      </span>
      <button
        type="button"
        onClick={() => { const undo = toast.onUndo; dismiss(); undo(); }}
        style={{
          flex: "none", height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid var(--line)",
          background: "var(--panel2)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        }}
      >
        실행취소
      </button>
    </div>
  ) : null;

  return { notify, dismiss, element };
}
