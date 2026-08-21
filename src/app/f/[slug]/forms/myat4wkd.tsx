"use client";

// 내 출결(읽기 전용) — 최근 30일 달력 히트맵(재실 시간 진하기) + 최근 10일 목록. 지각(스케쥴상 등원
// 시각보다 늦은 입실)은 히트맵 점·목록 배지로 표시한다. 쓰기 동작 없음 — student-info-actions.ts
// getMyAttendanceOverview 하나로 조회.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity } from "../../_shared/useIdentity";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import { getMyAttendanceOverview, type AttendanceOverviewResult, type AttendanceHeatCell } from "./student-info-actions";

export default function MyAttendanceView({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const router = useRouter();
  const hubSlug = getHubSlug();

  useEffect(() => {
    if (hydrated && !identity) router.replace(`/f/${hubSlug}`);
  }, [hydrated, identity, router, hubSlug]);

  const [result, setResult] = useState<AttendanceOverviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!hydrated || !identity) return;
    let alive = true;
    setLoading(true);
    const fd = new FormData();
    fd.set("slug", def.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    getMyAttendanceOverview(fd).then((r) => {
      if (!alive) return;
      if (!r.ok && r.kind === "identity") {
        clear();
        setExpired(true);
      } else {
        setResult(r);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, identity?.name, identity?.code, def.slug]);

  return (
    <FormShell title={def.title} subtitle={def.desc} maxWidth={480} backHref={`/f/${hubSlug}`}>
      {!hydrated || !identity ? null : expired ? (
        <IdentityExpired hubSlug={hubSlug} />
      ) : loading || !result ? (
        <div style={{ fontSize: 15, color: "var(--dim)", textAlign: "center", padding: "24px 4px" }}>불러오는 중…</div>
      ) : !result.ok ? (
        <div style={{ fontSize: 15, color: "var(--danger)", fontWeight: 600, textAlign: "center", padding: "24px 4px" }}>{result.error}</div>
      ) : result.testBypass ? (
        <NoDataNotice />
      ) : (
        <Content result={result} />
      )}
    </FormShell>
  );
}

function NoDataNotice() {
  return (
    <div style={{ textAlign: "center", padding: "28px 4px 8px" }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--panel2)", color: "var(--dim)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
        <InfoIcon />
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 8 }}>테스트 신원에는 데이터가 없어요</div>
      <div style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.6 }}>실제 학생 코드로 확인하면 출결 기록을 볼 수 있어요.</div>
    </div>
  );
}

const HEAT_LEGEND = [
  { pct: 0, label: "기록 없음" },
  { pct: 18, label: "~3시간" },
  { pct: 38, label: "3~6시간" },
  { pct: 62, label: "6~9시간" },
  { pct: 88, label: "9시간~" },
];

function Content({ result }: { result: Extract<AttendanceOverviewResult, { ok: true }> }) {
  const anyData = result.heat.some((c) => c.hasData);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="최근 30일" desc="색이 진할수록 재실 시간이 길어요 · 주황 점 = 지각">
        {!anyData ? (
          <EmptySection text="최근 30일 안에 출결 기록이 없어요." />
        ) : (
          <>
            <Heatmap leading={result.leading} cells={result.heat} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
              {HEAT_LEGEND.map((l) => (
                <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: l.pct === 0 ? "var(--panel2)" : `color-mix(in srgb, #12b886 ${l.pct}%, var(--card))`, border: "1px solid var(--line)" }} />
                  <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{l.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="최근 10일">
        {result.recent.length === 0 ? (
          <EmptySection text="출결 기록이 없어요." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.recent.map((d) => (
              <div
                key={d.date}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "12px 13px", borderRadius: 12, border: "1px solid var(--line)",
                  background: d.firstIn ? "var(--card)" : "var(--panel2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, width: 78 }}>{d.dateLabel}</span>
                  {d.late && (
                    <span className="chip" style={{ color: "var(--warn)", fontWeight: 700, fontSize: 12 }}>
                      지각
                    </span>
                  )}
                </div>
                {d.firstIn ? (
                  <span style={{ fontSize: 14, color: "var(--sub)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {d.firstIn} 입실{d.lastOut ? ` · ${d.lastOut} 퇴실` : " · 퇴실 미기록"}
                    {d.totalLabel && <span style={{ display: "block", color: "var(--faint)", fontSize: 12 }}>재실 {d.totalLabel}</span>}
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: "var(--faint)" }}>기록 없음</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: desc ? 2 : 10 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 10 }}>{desc}</div>}
      {children}
    </div>
  );
}

function EmptySection({ text }: { text: string }) {
  return <div style={{ fontSize: 15, color: "var(--faint)", padding: "12px 4px" }}>{text}</div>;
}

function Heatmap({ leading, cells }: { leading: number; cells: AttendanceHeatCell[] }) {
  const blanks = Array.from({ length: leading });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
      {blanks.map((_, i) => (
        <div key={`b${i}`} />
      ))}
      {cells.map((c) => (
        <div
          key={c.date}
          title={c.title ?? undefined}
          style={{
            position: "relative", aspectRatio: "1 / 1", borderRadius: 7,
            border: c.isToday ? "1.5px solid var(--accent)" : "1px solid var(--line)",
            background: c.color ?? "var(--card)",
            display: "grid", placeItems: "center",
          }}
        >
          <span style={{ fontSize: 9.5, color: c.hasData ? "var(--ink)" : "var(--faint)", fontVariantNumeric: "tabular-nums" }}>{c.dayNum}</span>
          {c.dot && <span style={{ position: "absolute", top: 2, right: 2, width: 5, height: 5, borderRadius: "50%", background: c.dot }} />}
        </div>
      ))}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
