"use client";

// 초대 코드를 직접 타이핑해 들어오는 진입점(문자·구두로 코드를 전달받은 경우).
// 링크로 바로 들어오면 /invite/[code] 로 직행하므로 이 페이지는 건너뛴다.
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

export default function InviteEntryPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!norm) return;
    router.push(`/invite/${norm}`);
  };

  return (
    <main style={S.wrap}>
      <form onSubmit={go} style={S.card}>
        <div style={S.brand}>StudyCube</div>
        <h1 style={S.h1}>직원 초대 코드</h1>
        <p style={S.sub}>전달받은 초대 코드를 입력하세요.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...S.input, letterSpacing: "0.12em", fontWeight: 700, textAlign: "center" }}
          placeholder="예) AB12CD34EF"
          autoFocus
        />
        <button type="submit" style={S.btn}>다음</button>
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
  input: {
    width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", fontSize: 15,
    marginBottom: 14, outline: "none", background: "#fbfcfe", color: "var(--ink)",
  },
  btn: {
    width: "100%", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700,
    background: "var(--accent)", color: "#fff", cursor: "pointer",
  },
};
