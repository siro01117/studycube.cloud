"use client";
import type { CSSProperties } from "react";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <main style={S.wrap}>
      <form action={action} style={S.card}>
        <div style={S.brand}>StudyCube</div>
        <h1 style={S.h1}>직원 로그인</h1>
        <p style={S.sub}>아이디와 6자리 PIN을 입력하세요.</p>

        <label style={S.label}>아이디</label>
        <input name="loginId" autoComplete="username" style={S.input} placeholder="예: 나한결" autoFocus />

        <label style={S.label}>PIN (6자리)</label>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="current-password"
          style={S.input}
          placeholder="••••••"
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
