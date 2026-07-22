// 배포 진단 페이지 — /health
// 로그인 없이 접속해서 "DB가 왜 안 붙는지"를 눈으로 확인하는 용도.
// 비밀번호·키는 절대 출력하지 않는다(마스킹). 문제 해결되면 이 파일 삭제.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { label: string; ok: boolean | null; detail: string };

/** 접속문자열에서 비밀번호를 지우고 사람이 볼 수 있는 요약만 만든다.
 *  bad = 반드시 고쳐야 하는 문제, info = 참고 사항(있어도 동작할 수 있음) */
function describeUrl(raw: string): { safe: string; pass: string | null; bad: string[]; info: string[] } {
  const bad: string[] = [];
  const info: string[] = [];
  let safe = "(형식을 읽을 수 없음)";
  let pass: string | null = null;
  try {
    const u = new URL(raw);
    pass = u.password ? decodeURIComponent(u.password) : null;
    const port = u.port || "(없음)";
    safe = `${u.protocol}//${u.username || "(계정없음)"}:●●●●●@${u.hostname}:${port}${u.pathname}`;
    if (!/^postgres(ql)?:$/.test(u.protocol))
      bad.push(`프로토콜이 ${u.protocol} 입니다 — postgresql:// 로 시작해야 합니다.`);
    if (raw.includes("[YOUR-PASSWORD]") || raw.includes("[PASSWORD]"))
      bad.push("주소 안에 [YOUR-PASSWORD] 가 그대로 남아 있습니다 — 실제 비밀번호로 바꿔야 합니다.");
    if (!u.password) bad.push("비밀번호가 비어 있습니다.");
    if (u.hostname.startsWith("db.") && u.hostname.endsWith(".supabase.co"))
      bad.push("직접 연결(db.xxx.supabase.co) 주소입니다 — Vercel에서는 연결이 안 됩니다. Connection string 의 Transaction 탭(포트 6543, ...pooler.supabase.com) 주소를 쓰세요.");
    if (u.hostname.includes("pooler") && port === "5432")
      info.push("Session pooler(5432)입니다. 서버리스에는 Transaction pooler(6543)를 권장하지만, 연결만 되면 동작은 합니다.");
    if (port === "6543") info.push("Transaction pooler(6543) — 권장 설정 맞습니다.");
    if (/\s/.test(raw)) bad.push("주소에 공백/줄바꿈이 섞여 있습니다 — 앞뒤 공백 없이 한 줄로 넣으세요.");
  } catch {
    bad.push("주소 형식이 잘못됐습니다. postgresql://... 전체를 붙여넣었는지 확인하세요.");
  }
  return { safe, pass, bad, info };
}

/** 에러 메시지에 혹시 비밀번호가 섞이면 지운다 (원문·URL인코딩 둘 다) */
function redact(msg: string, pass: string | null): string {
  let out = msg;
  for (const p of [pass, pass && encodeURIComponent(pass)]) {
    if (p && p.length > 2) out = out.split(p).join("●●●●●");
  }
  return out;
}

export default async function HealthPage() {
  const checks: Check[] = [];
  const which =
    (process.env.DATABASE_URL && "DATABASE_URL") ||
    (process.env.POSTGRES_URL && "POSTGRES_URL") ||
    (process.env.POSTGRES_PRISMA_URL && "POSTGRES_PRISMA_URL") ||
    null;
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || "";

  checks.push({
    label: "1. 환경변수",
    ok: !!which,
    detail: which
      ? `${which} 가 이 배포에 들어와 있습니다.`
      : "DATABASE_URL 이 없습니다. Vercel → Settings → Environment Variables 에서 추가하고, 반드시 Redeploy 하세요. (환경변수는 다시 배포해야 반영됩니다)",
  });

  let pass: string | null = null;
  if (which) {
    const d = describeUrl(raw);
    pass = d.pass;
    checks.push({
      label: "2. 접속 주소 형식",
      ok: d.bad.length === 0,
      detail: [d.safe, ...d.bad.map((n) => "✗ " + n), ...d.info.map((n) => "· " + n)].join("\n"),
    });

    // 3. 실제 연결 — 첫 쿼리(접속 포함)와 두 번째 쿼리(접속 이후)를 따로 재서
    //    지연이 '접속'에서 오는지 '쿼리'에서 오는지 눈으로 가른다.
    try {
      const t0 = performance.now();
      const { db } = await import("@/lib/db");
      const t1 = performance.now();
      const r = await db.query<{ v: number }>("select 1 as v");
      const t2 = performance.now();
      await db.query("select 1 as v");
      const t3 = performance.now();
      const ms = (a: number, b: number) => `${Math.round(b - a)}ms`;
      checks.push({
        label: "3. DB 연결",
        ok: r.rows[0]?.v === 1,
        detail:
          `Supabase 에 접속되었습니다.\n` +
          `· 드라이버 로드      ${ms(t0, t1)}\n` +
          `· 첫 쿼리(접속 포함)  ${ms(t1, t2)}   ← 이게 크면 매 요청 재접속이 원인\n` +
          `· 두 번째 쿼리        ${ms(t2, t3)}   ← 접속 이후 순수 왕복`,
      });

      // 4. 스키마 생성(부트스트랩)
      try {
        const { ready } = await import("@/lib/bootstrap");
        await ready();
        const t = await db.query<{ n: string }>(
          `select count(*)::text as n from information_schema.tables where table_schema='public'`,
        );
        const p = await db.query<{ n: string }>(`select count(*)::text as n from person`);
        checks.push({
          label: "4. 테이블 생성 · 초기 계정",
          ok: Number(p.rows[0]?.n ?? 0) > 0,
          detail: `public 스키마 테이블 ${t.rows[0]?.n ?? "?"}개, 직원 계정 ${p.rows[0]?.n ?? "?"}명.\n계정이 0명이면 초기화가 실패한 것입니다.`,
        });
      } catch (e) {
        checks.push({
          label: "4. 테이블 생성 · 초기 계정",
          ok: false,
          detail: redact(e instanceof Error ? `${e.message}` : String(e), pass),
        });
      }
    } catch (e) {
      checks.push({
        label: "3. DB 연결",
        ok: false,
        detail: redact(e instanceof Error ? `${e.message}` : String(e), pass),
      });
      checks.push({ label: "4. 테이블 생성 · 초기 계정", ok: null, detail: "3번이 먼저 통과해야 확인 가능합니다." });
    }
  } else {
    checks.push({ label: "2. 접속 주소 형식", ok: null, detail: "1번이 먼저 필요합니다." });
    checks.push({ label: "3. DB 연결", ok: null, detail: "1번이 먼저 필요합니다." });
    checks.push({ label: "4. 테이블 생성 · 초기 계정", ok: null, detail: "1번이 먼저 필요합니다." });
  }

  const allOk = checks.every((c) => c.ok === true);

  return (
    <main style={{ minHeight: "100dvh", padding: 24, display: "grid", placeItems: "start center", background: "#0b0d10" }}>
      <div style={{ width: "100%", maxWidth: 720, fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#e6e9ee" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>스터디큐브 배포 진단</div>
        <div style={{ fontSize: 13, color: "#93a0b4", marginBottom: 18 }}>
          이 페이지는 문제 해결용입니다. 다 되면 지웁니다.
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            marginBottom: 16,
            fontWeight: 700,
            background: allOk ? "#0f2e1c" : "#2e1414",
            border: `1px solid ${allOk ? "#1f6b3f" : "#7a2b2b"}`,
          }}
        >
          {allOk ? "✅ 전부 정상입니다. 로그인해서 쓰시면 됩니다." : "❌ 아래 ✗ 표시된 항목이 원인입니다."}
        </div>

        {checks.map((c) => (
          <div
            key={c.label}
            style={{
              border: "1px solid #232a33",
              background: "#12161c",
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 14.5 }}>
              <span style={{ color: c.ok === true ? "#4ade80" : c.ok === false ? "#f87171" : "#7b8798" }}>
                {c.ok === true ? "✓" : c.ok === false ? "✗" : "—"}
              </span>
              {c.label}
            </div>
            <pre
              style={{
                margin: "8px 0 0",
                fontSize: 12.5,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                color: "#b9c3d1",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {c.detail}
            </pre>
          </div>
        ))}
      </div>
    </main>
  );
}
