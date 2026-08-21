"use client";

// 본인확인 게이트 — 이름+코드로 학생을 먼저 찾는다. 지금은 허브(Hub.tsx)에서 한 번만 붙어
// 확인된 신원을 useIdentity() 로 sessionStorage 에 저장하고, 이후 폼들은 다시 이 게이트를
// 띄우지 않고 저장된 신원을 읽어서 쓴다(src/app/f/_shared/useIdentity.ts 참고).
// 실제 조회는 lib/public-auth.ts(findStudent) 그대로 재사용, 로직 재발명 금지.
// 확인되면 { name, code, studentId, studentName } 을 children 에 넘긴다.
// name/code 를 계속 들고 있는 이유: 실제 제출(submitForm)은 studentId 를 신뢰하지 않고
// 이름+코드로 다시 검증하기 때문에(위조 방지) 제출 시점에도 필요하다.
import { useState, useTransition } from "react";
import { findStudent } from "@/lib/public-auth-client"; // "use server" 래퍼 — 클라이언트에서 직접 import 가능(server-only 인 lib/public-auth 는 서버 전용)

export type StudentIdentity = { name: string; code: string; studentId: string; studentName: string; isRepeat: boolean };

export default function StudentGate({
  subtitle = "본인 확인 후 참여할 수 있어요.",
  children,
}: {
  subtitle?: string;
  children: (identity: StudentIdentity) => React.ReactNode;
}) {
  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (identity) return <>{children(identity)}</>;

  const verify = () => {
    if (!name || !code) return;
    setErr(null);
    start(async () => {
      const r = await findStudent(name, code);
      if (r.ok) setIdentity({ name, code, studentId: r.id, studentName: r.name, isRepeat: r.isRepeat });
      else setErr(r.reason === "locked" ? "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." : "이름과 코드를 확인해주세요.");
    });
  };

  return (
    <div>
      <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 20 }}>{subtitle}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label>
          <span className="label">이름</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            onKeyDown={(e) => e.key === "Enter" && code && verify()}
          />
        </label>
        <label>
          <span className="label">코드</span>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="학원에서 받은 5자리 코드"
            inputMode="numeric"
            onKeyDown={(e) => e.key === "Enter" && name && verify()}
          />
        </label>
        {err && <div style={errStyle}><InfoIcon />{err}</div>}
        <button className="btn btn-accent" disabled={pending || !name || !code} onClick={verify} style={{ height: 48, marginTop: 2, fontSize: 15 }}>
          {pending ? "확인 중…" : "본인 확인"}
        </button>
      </div>
    </div>
  );
}

const errStyle: React.CSSProperties = { fontSize: 12.5, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 };

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
