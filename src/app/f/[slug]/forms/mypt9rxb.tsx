"use client";

// 내 벌점(읽기 전용) — 이번 주 벌점 + 최근 30일 위반 횟수를 크게, 사유별 구성, 최근 내역 10건.
// 판정 기준은 관리 화면과 동일(위반 = 점수가 0보다 큰 이벤트, 순찰+수동 벌점 합산 — 자세한 근거는
// student-info-actions.ts getMyPenaltyOverview 주석 참고). 쓰기 동작 없음. 신원 가드/로딩·에러 스위치/
// 빈 상태 안내는 공용 셸 ReadOnlyInfoShell(../../_shared/ReadOnlyInfoShell.tsx)이 맡는다.
import ReadOnlyInfoShell, { Section, EmptySection } from "../../_shared/ReadOnlyInfoShell";
import type { FormDef } from "../../registry";
import { getMyPenaltyOverview, type PenaltyOverviewResult } from "./student-info-actions";
import { penaltyHeat, PENALTY_WARN } from "@/lib/penalty";

export default function MyPenaltyView({ def }: { def: FormDef }) {
  return (
    <ReadOnlyInfoShell<Extract<PenaltyOverviewResult, { ok: true }>>
      def={def}
      fetchResult={getMyPenaltyOverview}
      noDataText="실제 학생 코드로 확인하면 벌점 내역을 볼 수 있어요."
    >
      {(result) => <Content result={result} />}
    </ReadOnlyInfoShell>
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
