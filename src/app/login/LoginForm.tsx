"use client";
import type { CSSProperties } from "react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "./actions";
import { normalizeLoginId } from "@/lib/hangul-romanize";

const initial: LoginState = {};

// next: 로그인 후 돌아갈 경로(선택). QR 근태 스캔이 로그인 없이 열렸을 때(/m/staff/attendance/scan)
// "/login?next=/m/staff/attendance/continue" 로 보내는 용도 — page.tsx(서버)가 searchParams 에서
// 읽어 내려준다(이 파일은 "use client" 라 useSearchParams 훅도 되지만, Suspense 경계 없이 페이지
// 최상단에서 쓰면 정적 최적화가 깨지는 경우가 있어 서버 쪽에서 읽어 prop 으로 내려주는 이 레포의
// 기존 패턴 — 다른 view 컴포넌트들이 서버 page.tsx 에서 값을 받는 방식 — 을 그대로 따른다).
export default function LoginForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(loginAction, initial);
  // 아이디 칸: onChange 는 필터만(글자·숫자가 아닌 것만 제거 — 한글 조합 중에도 그대로 통과시켜야
  // IME 입력이 깨지지 않는다), 정규화(두벌식 환원 + 소문자화 + 영문·숫자만 남기기)는 onBlur 에서
  // e.currentTarget.value 기준으로. 최종 판정은 서버(auth.ts authenticate)가 같은 함수로 다시 하므로
  // 여기서 놓쳐도 로그인 자체는 안전하다 — 이건 사용자 편의용.
  const [loginId, setLoginId] = useState("");

  return (
    <main style={S.wrap}>
      <form action={action} style={S.card}>
        <div style={S.brand}>StudyCube</div>
        <h1 style={S.h1}>직원 로그인</h1>
        <p style={S.sub}>아이디와 비밀번호를 입력하세요.</p>

        {next && <input type="hidden" name="next" value={next} />}

        <label style={S.label}>아이디</label>
        <input
          name="loginId"
          autoComplete="username"
          style={S.input}
          placeholder="영문·숫자 (한글로 쳐도 자동 변환)"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value.replace(/[^\p{L}\p{N}]/gu, ""))}
          onBlur={(e) => setLoginId(normalizeLoginId(e.currentTarget.value))}
          autoFocus
        />

        <label style={S.label}>비밀번호</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          style={S.input}
          placeholder="비밀번호"
        />

        <label style={S.remember}>
          <input type="checkbox" name="remember" defaultChecked style={{ width: 15, height: 15 }} />
          로그인 유지
        </label>

        {state?.error && <div style={S.err}>{state.error}</div>}

        <button type="submit" disabled={pending} style={{ ...S.btn, ...(pending ? S.btnOff : {}) }}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

const S: Record<string, CSSProperties> = {
  wrap: { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card)", border: "1px solid var(--line)",
    borderRadius: 16, padding: "30px 28px", boxShadow: "0 6px 24px rgba(20,22,30,.06)", display: "flex", flexDirection: "column",
  },
  brand: { fontSize: 12, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent)" },
  h1: { fontSize: 21, fontWeight: 800, marginTop: 8 },
  sub: { fontSize: 13.5, color: "var(--sub)", marginTop: 4, marginBottom: 18 },
  label: { fontSize: 12.5, fontWeight: 700, color: "var(--sub)", marginBottom: 6 },
  input: {
    width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15,
    marginBottom: 14, outline: "none", background: "#fbfcfe", color: "var(--ink)",
  },
  remember: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--sub)", marginBottom: 16, cursor: "pointer" },
  err: { background: "#fdeef4", color: "#a83267", border: "1px solid #f3d4e2", borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 14 },
  btn: {
    width: "100%", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700,
    background: "var(--accent)", color: "#fff", cursor: "pointer",
  },
  btnOff: { opacity: 0.6, cursor: "default" },
};
