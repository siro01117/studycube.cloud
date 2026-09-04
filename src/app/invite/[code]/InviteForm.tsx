"use client";

import { useActionState, useState, type CSSProperties } from "react";
import { submitInvite, checkLoginId, type SubmitState } from "../actions";
import { normalizeLoginId } from "@/lib/hangul-romanize";
import { pinProblem, PIN_HINT } from "@/lib/credential";

const initial: SubmitState = {};

export default function InviteForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(submitInvite, initial);
  // 아이디 칸: onChange 는 필터만, 정규화(두벌식 환원 + 소문자화)는 onBlur 에서 — login/page.tsx 와 같은 규칙.
  const [loginId, setLoginId] = useState("");
  const [dup, setDup] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  // 서버(redeemInvite)와 같은 함수로 판단한다 — 두 곳의 규칙이 어긋나면 눌리는데 안 되는 버튼이 된다.
  const pinBad = pinProblem(pin);

  const runDupCheck = async (raw: string) => {
    const normalized = normalizeLoginId(raw);
    setLoginId(normalized);
    if (!normalized) { setDup("idle"); return; }
    setDup("checking");
    const r = await checkLoginId(normalized);
    setDup(r.available ? "ok" : "taken");
  };

  const mismatch = pinConfirm.length > 0 && pin !== pinConfirm;

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="code" value={code} />

      <div>
        <label style={S.label} htmlFor="inv-login">아이디</label>
        <input
          id="inv-login"
          name="loginId"
          autoComplete="username"
          style={S.input}
          placeholder="영문·숫자 (한글로 쳐도 자동 변환)"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value.replace(/[^\p{L}\p{N}]/gu, ""))}
          onBlur={(e) => runDupCheck(e.currentTarget.value)}
          autoFocus
        />
        {dup === "checking" && <div style={S.hint}>확인 중…</div>}
        {dup === "ok" && <div style={{ ...S.hint, color: "var(--ok)" }}>사용할 수 있는 아이디입니다.</div>}
        {dup === "taken" && <div style={{ ...S.hint, color: "var(--danger-strong)" }}>이미 사용 중인 아이디입니다.</div>}
      </div>

      <div>
        <label style={S.label} htmlFor="inv-pin">비밀번호</label>
        <input
          id="inv-pin"
          name="pin"
          type="password"
          autoComplete="new-password"
          style={S.input}
          placeholder={PIN_HINT}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {pin.length > 0 && pinBad
          ? <div style={{ ...S.hint, color: "var(--danger-strong)" }}>{pinBad}</div>
          : <div style={S.hint}>{PIN_HINT}</div>}
      </div>

      <div>
        <label style={S.label} htmlFor="inv-pin2">비밀번호 확인</label>
        <input
          id="inv-pin2"
          name="pinConfirm"
          type="password"
          autoComplete="new-password"
          style={S.input}
          placeholder="다시 입력"
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value)}
        />
        {mismatch && <div style={{ ...S.hint, color: "var(--danger-strong)" }}>비밀번호가 일치하지 않습니다.</div>}
      </div>

      {state?.error && <div style={S.err}>{state.error}</div>}

      <button
        type="submit"
        disabled={pending || dup === "taken" || !loginId || pinBad !== null || mismatch}
        style={{ ...S.btn, ...(pending || dup === "taken" || !loginId || pinBad !== null || mismatch ? S.btnOff : {}) }}
      >
        {pending ? "만드는 중…" : "계정 만들기"}
      </button>
    </form>
  );
}

const S: Record<string, CSSProperties> = {
  label: { fontSize: 12.5, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" },
  input: {
    width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15,
    outline: "none", background: "#fbfcfe", color: "var(--ink)",
  },
  hint: { fontSize: 12, color: "var(--sub)", marginTop: 5 },
  err: { background: "#fdeef4", color: "#a83267", border: "1px solid #f3d4e2", borderRadius: 9, padding: "9px 12px", fontSize: 13 },
  btn: {
    width: "100%", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700,
    background: "var(--accent)", color: "#fff", cursor: "pointer", marginTop: 4,
  },
  btnOff: { opacity: 0.6, cursor: "default" },
};
