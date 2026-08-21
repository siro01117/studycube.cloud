"use client";

// 내 시간표(읽기 전용) — 요일별 등·하원 + 정기 일정 + 승인된 임시 일정(이번 주·다음 주)을 한 화면에서
// 확인한다. 쓰기 동작 없음 — 전부 student-info-actions.ts getMyScheduleOverview 하나로 조회.
// 흐름은 다른 공개 폼과 동일: 신원 없이 바로 들어오면 허브로, 화면 진입 시 한 번만 서버에 묻는다.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity } from "../../_shared/useIdentity";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import { blockStyleOf } from "@/lib/schedule";
import {
  getMyScheduleOverview,
  type MyScheduleOverviewResult,
  type MyExceptionRow,
} from "./student-info-actions";
import type { MyHoursRow, MyRuleRow } from "./schedule-request-actions";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

export default function MyScheduleView({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const router = useRouter();
  const hubSlug = getHubSlug();

  useEffect(() => {
    if (hydrated && !identity) router.replace(`/f/${hubSlug}`);
  }, [hydrated, identity, router, hubSlug]);

  const [result, setResult] = useState<MyScheduleOverviewResult | null>(null);
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
    getMyScheduleOverview(fd).then((r) => {
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
      <div style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.6 }}>
        실제 학생 코드로 확인하면 시간표를 볼 수 있어요.
      </div>
    </div>
  );
}

const statusChip: Record<"pending" | "done" | "rejected", { label: string; fg: string; bg: string }> = {
  pending: { label: "검토 대기", fg: "var(--warn)", bg: "var(--warn-soft)" },
  done: { label: "반영됨", fg: "var(--accent)", bg: "var(--accent-soft)" },
  rejected: { label: "반려됨", fg: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 12%, transparent)" },
};

function Content({ result }: { result: Extract<MyScheduleOverviewResult, { ok: true }> }) {
  const hasHours = result.hours.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {result.submissionStatus && (
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
            height: 28, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            color: statusChip[result.submissionStatus].fg, background: statusChip[result.submissionStatus].bg,
          }}
        >
          제출 상태 · {statusChip[result.submissionStatus].label}
        </div>
      )}
      {result.submissionStatus === "rejected" && result.submissionNote && (
        <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600, marginTop: -12 }}>반려 사유: {result.submissionNote}</div>
      )}

      {!hasHours ? (
        <EmptySection text="아직 등록된 시간표가 없어요." />
      ) : (
        <>
          <Section title="주간 시간표">
            <MiniTimetable hours={result.hours} rules={result.rules} exceptions={result.exceptions} />
          </Section>

          <Section title="요일별 등·하원">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DAY_LABELS.map((label, i) => {
                const row = result.hours.find((h) => h.day === i + 1);
                return (
                  <div
                    key={label}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)",
                      background: row ? "var(--card)" : "var(--panel2)",
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 800, width: 24 }}>{label}</span>
                    <span style={{ fontSize: 15, color: row ? "var(--sub)" : "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
                      {row ? `${row.arriveLabel} 등원 · ${row.leaveLabel} 하원` : "쉬는 날"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="정기 일정">
            {result.rules.length === 0 ? (
              <EmptySection text="등록된 정기 일정이 없어요." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {result.rules.map((r) => (
                  <RuleRowView key={r.id} row={r} />
                ))}
              </div>
            )}
          </Section>

          <Section title="승인된 임시 일정" desc="이번 주 · 다음 주 기준">
            {result.exceptions.length === 0 ? (
              <EmptySection text="예정된 임시 일정이 없어요." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {result.exceptions.map((ex) => (
                  <ExceptionRowView key={ex.id} row={ex} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
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
  return (
    <div style={{ fontSize: 15, color: "var(--faint)", padding: "12px 4px" }}>{text}</div>
  );
}

function RuleRowView({ row }: { row: MyRuleRow }) {
  const style = blockStyleOf(row.reason);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12, border: `1px solid ${style.bd}`, background: style.bg }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: style.bd, flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: style.fg }}>
          {row.reason}
          {row.title && <span style={{ color: "var(--dim)", fontWeight: 500 }}> · {row.title}</span>}
        </div>
        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 3 }}>
          {row.daysLabel} · {row.timeLabel}
        </div>
      </div>
    </div>
  );
}

function ExceptionRowView({ row }: { row: MyExceptionRow }) {
  const style = blockStyleOf(row.reason);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12, border: `1px dashed ${style.bd}`, background: style.bg }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: style.bd, flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: style.fg }}>
          {row.reason}
          {row.title && <span style={{ color: "var(--dim)", fontWeight: 500 }}> · {row.title}</span>}
        </div>
        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 3 }}>
          {row.dateLabel} · {row.timeLabel}
        </div>
      </div>
    </div>
  );
}

// ---------------- 주간 미니 타임테이블(읽기 전용) ----------------
// sch9m2vt.tsx MiniTimetable 과 같은 발상(07:00~익일01:00, 눈금 07·12·18·23) 이지만, 이 화면은 빌더
// 입력이 아니라 이미 서버에서 받은 hours/rules/exceptions 를 그대로 그리기만 하면 돼서 더 단순하다.
const TT_START = 7 * 60;
const TT_END = 25 * 60;
const TT_SPAN = TT_END - TT_START;
const TT_HEIGHT = 260;
const TT_GUTTER = 28;
const TT_AXIS = [7, 12, 18, 23].map((h) => h * 60);
const AXIS_LINE = "color-mix(in srgb, var(--line) 55%, transparent)";
const MUTE_OVERLAY = "color-mix(in srgb, var(--panel2) 80%, transparent)";
const REST_OVERLAY = "color-mix(in srgb, var(--panel2) 88%, transparent)";
const clampY = (n: number) => Math.min(TT_HEIGHT, Math.max(0, n));
const pad2 = (n: number) => String(n).padStart(2, "0");

function MiniTimetable({ hours, rules, exceptions }: { hours: MyHoursRow[]; rules: MyRuleRow[]; exceptions: MyExceptionRow[] }) {
  const yOf = (min: number) => clampY(Math.round(((min - TT_START) / TT_SPAN) * TT_HEIGHT));
  const hoursByDay = new Map(hours.map((h) => [h.day, h]));

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: TT_GUTTER, flex: "none" }} />
        {DAY_LABELS.map((label, i) => {
          const d = i + 1;
          const rest = !hoursByDay.has(d);
          return (
            <div
              key={d}
              style={{
                flex: 1, textAlign: "center", fontSize: 11, fontWeight: 700, padding: "6px 0",
                color: rest ? "var(--faint)" : "var(--sub)", borderBottom: "1px solid var(--line)",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", height: TT_HEIGHT }}>
        <div style={{ width: TT_GUTTER, flex: "none", position: "relative" }}>
          {TT_AXIS.map((min) => (
            <span key={min} style={{ position: "absolute", right: 4, top: yOf(min) - 6, fontSize: 9.5, color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
              {pad2(min / 60)}
            </span>
          ))}
        </div>
        {DAY_LABELS.map((_, i) => {
          const d = i + 1;
          const hm = hoursByDay.get(d);
          const dayRules = rules.filter((r) => r.days.includes(d));
          const dayExceptions = exceptions.filter((ex) => ex.wd === d);
          return (
            <div key={d} style={{ flex: 1, position: "relative", borderLeft: "1px solid var(--line)" }}>
              {TT_AXIS.map((min) => (
                <div key={min} style={{ position: "absolute", left: 0, right: 0, top: yOf(min), height: 1, background: AXIS_LINE }} />
              ))}
              {!hm && <div style={{ position: "absolute", inset: 0, background: REST_OVERLAY }} />}
              {hm && (
                <>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: yOf(hm.arrive), background: MUTE_OVERLAY }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.leave), bottom: 0, background: MUTE_OVERLAY }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.arrive) - 0.75, height: 1.5, background: "var(--sub)" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.leave) - 0.75, height: 1.5, background: "var(--sub)" }} />
                </>
              )}
              {dayRules.map((r) => {
                const style = blockStyleOf(r.reason);
                const top = yOf(r.start);
                const height = Math.max(3, yOf(r.end) - top);
                return (
                  <div
                    key={r.id}
                    title={`${r.reason} ${r.timeLabel}`}
                    style={{ position: "absolute", left: 2, right: 2, top, height, background: style.bg, border: `1px solid ${style.bd}`, borderRadius: 3 }}
                  />
                );
              })}
              {dayExceptions.map((ex) => {
                const style = blockStyleOf(ex.reason);
                const [sLabel] = ex.timeLabel.split("–");
                const start = parseClockLabel(sLabel);
                const overnight = ex.timeLabel.includes("다음날");
                const endLabelRaw = overnight ? ex.timeLabel.split("다음날 ")[1] : ex.timeLabel.split("–")[1];
                const endParsed = parseClockLabel(endLabelRaw ?? "");
                if (start == null || endParsed == null) return null;
                const endRaw = overnight ? endParsed + 1440 : endParsed;
                const top = yOf(start);
                const height = Math.max(3, yOf(endRaw) - top);
                return (
                  <div
                    key={ex.id}
                    title={`${ex.reason} ${ex.dateLabel} ${ex.timeLabel}`}
                    style={{ position: "absolute", left: 2, right: 2, top, height, background: style.bg, border: `1.5px dashed ${style.bd}`, borderRadius: 3 }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "HH:MM" → 분(0~1439). 파싱 실패면 null. timeLabel(fmtRange 결과)을 다시 쪼개 쓰는 용도라 서버가
 * 만든 고정 포맷("HH:MM")만 신뢰한다 — 사용자 입력을 파싱하는 게 아니므로 클라 new Date() 금지 원칙과 무관. */
function parseClockLabel(label: string): number | null {
  const m = label.trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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
