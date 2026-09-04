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

      {/* 기간 명시 — "이번 주"가 언제부터 언제까지인지, 언제 리셋되는지를 숫자만으로는 알 수 없어서
          날짜로 못박아 보여준다(집주인 지적: 기간·분기점이 불명확). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line)" }}>
        <span style={{ flex: "none", color: "var(--faint)", display: "flex" }}>
          <ClockIcon />
        </span>
        <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700, color: "var(--sub)" }}>이번 주 기간: {result.weekStartLabel} ~ {result.weekEndLabel}</span>
          <br />
          매주 월요일 0시에 0점으로 초기화돼요.
        </div>
      </div>

      <Section title="최근 6주 추이" desc="주마다 받은 벌점 합계 — 이번 주는 강조 표시">
        {result.weeklyTrend.every((w) => w.points === 0) ? (
          <EmptySection text="최근 6주 동안 벌점 기록이 없어요." />
        ) : (
          <TrendChart weeks={result.weeklyTrend} />
        )}
      </Section>

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

      <Section title="최근 내역" desc="최근 30일 · 최대 10건 · 언제·무슨 일로·몇 점인지">
        {result.recent.length === 0 ? (
          <EmptySection text="위반 내역이 없어요." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.recent.map((r, i) => (
              <div key={`${r.date}-${r.time}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.dot, flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{r.label}</span>
                    <SourceChip src={r.src} />
                  </div>
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

/** 순찰 중 자동 기록("patrol")인지 카운터가 직접 부여("manual")한지 — 관리 화면은 이미 이 둘을
 * 구분해 보여준다(m/penalty DetailRow.source). 색은 중립(sub/panel2)만 써서 "감점 강조"가 아니라
 * "출처 표기"로만 읽히게 한다(비난조 금지 원칙 — 점수 자체가 이미 벌이라 출처까지 강조할 필요 없음). */
function SourceChip({ src }: { src: "patrol" | "manual" }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 7px" }}>
      {src === "patrol" ? "순찰 확인" : "카운터 부여"}
    </span>
  );
}

/** 최근 6주 벌점 합계를 막대로 — 관리 화면(m/penalty/PenaltyView.tsx)의 "최근 6주 추이" 막대와 같은
 * 발상이지만, 학생 화면은 폰 폭(375)에서 6개가 한 줄에 다 들어와야 해서 라벨을 "8/25"로 더 줄이고
 * 막대를 살짝 더 두껍게 뒀다. 0점인 주도 있는 그대로 낮은 막대로 보여줘 "줄고 있는지"가 눈에 보이게 한다. */
function TrendChart({ weeks }: { weeks: { weekStart: string; weekLabel: string; points: number; isCurrent: boolean }[] }) {
  const maxPts = Math.max(1, ...weeks.map((w) => w.points));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 76, padding: "4px 2px 0" }}>
      {weeks.map((w) => {
        const heat = penaltyHeat(w.points);
        const barH = w.points > 0 ? Math.max(6, Math.round((w.points / maxPts) * 46)) : 3;
        return (
          <div key={w.weekStart} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: w.points > 0 ? heat.fg : "var(--faint)", fontVariantNumeric: "tabular-nums" }}>{w.points}</span>
            <div style={{ width: "100%", height: 46, display: "flex", alignItems: "flex-end" }}>
              <div
                style={{
                  width: "100%", height: barH, borderRadius: 4,
                  background: w.points > 0 ? heat.fg : "var(--line)",
                  opacity: w.points > 0 ? (w.isCurrent ? 1 : 0.55) : 0.45,
                }}
              />
            </div>
            <span style={{ fontSize: 10.5, fontWeight: w.isCurrent ? 800 : 500, color: w.isCurrent ? "var(--accent)" : "var(--faint)" }}>
              {w.weekLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
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
