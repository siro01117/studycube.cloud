"use client";

// 내 벌점(읽기 전용) — 이번 주 벌점 + 최근 30일 위반 횟수를 크게, 사유별 구성, 최근 내역 10건.
// 판정 기준은 관리 화면과 동일(위반 = 점수가 0보다 큰 이벤트, 순찰+수동 벌점 합산 — 자세한 근거는
// student-info-actions.ts getMyPenaltyOverview 주석 참고). 쓰기 동작 없음.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity } from "../../_shared/useIdentity";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import { getMyPenaltyOverview, type PenaltyOverviewResult } from "./student-info-actions";
import { penaltyHeat, PENALTY_WARN } from "@/lib/penalty";

export default function MyPenaltyView({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const router = useRouter();
  const hubSlug = getHubSlug();

  useEffect(() => {
    if (hydrated && !identity) router.replace(`/f/${hubSlug}`);
  }, [hydrated, identity, router, hubSlug]);

  const [result, setResult] = useState<PenaltyOverviewResult | null>(null);
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
    getMyPenaltyOverview(fd).then((r) => {
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
      <div style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.6 }}>실제 학생 코드로 확인하면 벌점 내역을 볼 수 있어요.</div>
    </div>
  );
}

function Content({ result }: { result: Extract<PenaltyOverviewResult, { ok: true }> }) {
  const weekHeat = penaltyHeat(result.thisWeekPoints);
  const warn = result.thisWeekPoints >= PENALTY_WARN;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <BigStat label="이번 주 벌점" value={`${result.thisWeekPoints}점`} fg={weekHeat.fg} bg={weekHeat.bg} bd={weekHeat.bd} sub={warn ? "주의 기준 이상이에요" : undefined} />
        <BigStat label="최근 30일 위반" value={`${result.last30ViolationCount}건`} fg="var(--sub)" bg="var(--panel2)" bd="var(--line)" />
      </div>

      <Section title="사유별 구성" desc="최근 30일 기준">
        {result.reasonBars.length === 0 ? (
          <EmptySection text="최근 30일 안에 위반 기록이 없어요." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {result.reasonBars.map((r) => (
              <div key={r.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{r.label}</span>
                  <span style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>{r.count}회 · {r.points}점</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--panel2)", overflow: "hidden" }}>
                  <div style={{ width: `${r.pct}%`, height: "100%", borderRadius: 999, background: "var(--danger)" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="최근 내역" desc="최근 10건">
        {result.recent.length === 0 ? (
          <EmptySection text="위반 내역이 없어요." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.recent.map((r, i) => (
              <div key={`${r.date}-${r.time}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.dot, flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 1 }}>{r.dateLabel} · {r.time}</div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "var(--danger)", flex: "none" }}>+{r.points}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function BigStat({ label, value, fg, bg, bd, sub }: { label: string; value: string; fg: string; bg: string; bd: string; sub?: string }) {
  return (
    <div style={{ flex: 1, padding: "16px 14px", borderRadius: 14, border: `1px solid ${bd}`, background: bg }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--dim)" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: fg, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: fg, fontWeight: 700, marginTop: 4 }}>{sub}</div>}
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

function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
