"use client";

// 입·퇴실을 수동으로 찍은 직후 "학부모에게 문자를 보낼까요?" 를 물어보는 공용 훅.
// 브라우저 confirm() 금지(DESIGN.md) — 화면 하단에 뜨는 작은 바(토스트, 그림자 허용 — 깊이 규칙의
// "떠 있음" 예외)로 2단계 확인을 대신한다. checkIn/checkOut(attendanceActions.ts) 은 문자를
// 스스로 보내지 않고 promptSms 만 돌려준다 — 여기서 그 신호를 받아 사람에게 물은 뒤에만
// confirmAttendanceSms() 를 부른다.
// 좌석 배치도(FloorEditor.tsx 데스크톱)·모바일/태블릿(MobileSeat.tsx)·학생 팝업(StudentPopup.tsx)
// 셋 다 각자 이 훅을 부른다(전역 컨텍스트로 묶지 않은 이유: 세 화면이 항상 같은 트리 아래 있지
// 않아서 — StudentPopup 은 학생 목록 등 다른 화면에도 얹힌다).
import { useState, useTransition, type ReactNode } from "react";
import { confirmAttendanceSms, type AttendanceRecordResult } from "./attendanceActions";

type PendingKind = "attend_in" | "attend_out";
type Pending = { studentId: string; studentName: string; kind: PendingKind };

export function useAttendanceSmsPrompt(): {
  maybePrompt: (result: AttendanceRecordResult, studentId: string, studentName: string, kind: PendingKind) => void;
  node: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [isPending, startTransition] = useTransition();

  function maybePrompt(result: AttendanceRecordResult, studentId: string, studentName: string, kind: PendingKind) {
    if (result.promptSms) setPending({ studentId, studentName, kind });
  }

  function send() {
    if (!pending) return;
    const fd = new FormData();
    fd.set("studentId", pending.studentId);
    fd.set("kind", pending.kind);
    const p = pending;
    setPending(null);
    startTransition(async () => { await confirmAttendanceSms(fd); void p; });
  }

  const node = pending ? (
    <div
      style={{
        position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 300,
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12,
        boxShadow: "var(--shadow-lg)", maxWidth: "min(92vw, 420px)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink)" }}>
        {pending.studentName} 학생 보호자에게 {pending.kind === "attend_in" ? "입실" : "퇴실"} 문자를 보낼까요?
      </span>
      <button
        className="btn btn-accent"
        disabled={isPending}
        onClick={send}
        style={{ height: 30, padding: "0 12px", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        보내기
      </button>
      <button
        className="chip"
        disabled={isPending}
        onClick={() => setPending(null)}
        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
      >
        건너뛰기
      </button>
    </div>
  ) : null;

  return { maybePrompt, node };
}
