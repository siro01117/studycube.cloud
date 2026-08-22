"use client";

// 도시락 신청 폼 — 월 격자(주차 × 월~토) 안에서 날짜마다 중식/석식을 켜고 끄는 화면. 완료 화면으로
// 튕기지 않고 계속 남아 수정할 수 있다(스케쥴 위저드와 다른 점 — 도시락은 "제출"이 아니라 "상태 저장").
// 격자·휴무 규칙·마감 판정은 전부 src/lib/lunch.ts 의 순수 함수를 그대로 쓴다(재발명 금지) — 이 화면과
// 서버 액션(lunch-actions.ts)이 같은 함수를 써야 클라·서버 판정이 어긋나지 않는다.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { LockPopup } from "../../_shared/LockedInfo";
import { useIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import {
  monthGrid, effectiveClosure, mealAvailable, mealLocked, dowOf, won, monthLabel, noticeLines,
  type Closure, type MealType, type GridDay,
} from "@/lib/lunch";
import { getLunchData, saveLunchOrder, type Tab, type LunchDataResult } from "./lunch-actions";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토"];
type ReadyData = Extract<LunchDataResult, { ok: true }>;
type MealKey = string; // `${date}|${meal}`
const keyOf = (date: string, meal: MealType): MealKey => `${date}|${meal}`;
const setsEqual = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((v) => b.has(v));

export default function LunchForm({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const router = useRouter();
  const hubSlug = getHubSlug();
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<Tab>("current");
  const [nextOpen, setNextOpen] = useState<boolean | null>(null);
  const [lockLines, setLockLines] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (hydrated && !identity) router.replace(`/f/${hubSlug}`);
  }, [hydrated, identity, router, hubSlug]);

  const onExpired = () => {
    clear();
    setExpired(true);
  };

  return (
    <FormShell title={def.title} subtitle={def.intro} maxWidth={640} backHref={`/f/${hubSlug}`} confirmLeave={dirty}>
      {!hydrated || !identity ? null : expired ? (
        <IdentityExpired hubSlug={hubSlug} />
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <UserIcon />
            {identity.studentName} 학생으로 확인되었어요.
          </div>

          <TabsBar
            tab={tab}
            nextOpen={nextOpen}
            onSelect={(t) => {
              if (t === "next" && nextOpen === false) {
                setLockLines(["다음 달 신청은 25일부터 열려요"]);
                return;
              }
              setTab(t);
            }}
          />

          <MonthPanel
            key={tab}
            tab={tab}
            identity={identity}
            slug={def.slug}
            onExpired={onExpired}
            onNextOpenKnown={setNextOpen}
            onDirtyChange={setDirty}
          />
        </>
      )}
      {lockLines && <LockPopup title="다음 달 신청" lines={lockLines} onClose={() => setLockLines(null)} />}
    </FormShell>
  );
}

// ---------------- 탭 ----------------
function TabsBar({ tab, nextOpen, onSelect }: { tab: Tab; nextOpen: boolean | null; onSelect: (t: Tab) => void }) {
  const nextLocked = nextOpen === false;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
      <TabButton active={tab === "current"} onClick={() => onSelect("current")}>
        이번 달
      </TabButton>
      <TabButton active={tab === "next"} locked={nextLocked} onClick={() => onSelect("next")}>
        다음 달
        {nextLocked && <LockSmallIcon />}
      </TabButton>
    </div>
  );
}

function TabButton({ active, locked, onClick, children }: { active: boolean; locked?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, height: 44, borderRadius: 12, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--card)", color: active ? "var(--accent)" : locked ? "var(--faint)" : "var(--ink)",
        fontSize: 14, fontWeight: active ? 800 : 700, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}
    >
      {children}
    </button>
  );
}

// ---------------- 월 패널(데이터 로드 + 격자 + 요약 바) ----------------
type PanelState =
  | { phase: "loading" }
  | { phase: "error"; error: string; kind?: "identity" }
  | { phase: "ready"; data: ReadyData };

function MonthPanel({
  tab, identity, slug, onExpired, onNextOpenKnown, onDirtyChange,
}: {
  tab: Tab;
  identity: StoredIdentity;
  slug: string;
  onExpired: () => void;
  onNextOpenKnown: (v: boolean) => void;
  onDirtyChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [selected, setSelected] = useState<Set<MealKey>>(new Set());
  const [original, setOriginal] = useState<Set<MealKey>>(new Set());
  const [lockedApplied, setLockedApplied] = useState<Set<MealKey>>(new Set());
  const [saving, startSave] = useTransition();
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  const load = () => {
    setState({ phase: "loading" });
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    fd.set("tab", tab);
    if (identity._test) fd.set("test", "1");
    getLunchData(fd).then((r) => {
      if (!r.ok) {
        if (r.kind === "identity") {
          onExpired();
          return;
        }
        setState({ phase: "error", error: r.error });
        return;
      }
      onNextOpenKnown(r.nextOpen);
      const unlocked = new Set<MealKey>();
      const locked = new Set<MealKey>();
      for (const m of r.myMeals) {
        const k = keyOf(m.date, m.meal_type);
        if (mealLocked(m.date, m.meal_type, r.today, r.nowMin)) locked.add(k);
        else unlocked.add(k);
      }
      setSelected(new Set(unlocked));
      setOriginal(unlocked);
      setLockedApplied(locked);
      setSaveErr(null);
      setState({ phase: "ready", data: r });
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [tab]);

  const dirty = useMemo(() => !setsEqual(selected, original), [selected, original]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  if (state.phase === "loading") {
    return <div style={{ fontSize: 13.5, color: "var(--dim)", textAlign: "center", padding: "24px 4px" }}>불러오고 있어요…</div>;
  }
  if (state.phase === "error") {
    return <div style={{ fontSize: 13.5, color: "var(--danger)", fontWeight: 600, textAlign: "center", padding: "24px 4px" }}>{state.error}</div>;
  }

  const r = state.data;

  if (r.isTest) {
    return (
      <div style={{ fontSize: 13.5, color: "var(--dim)", textAlign: "center", padding: "24px 4px", lineHeight: 1.6 }}>
        테스트 신원에는 신청 데이터가 없어요.
        <br />
        실제 학생으로 접속하면 이 달의 도시락을 신청할 수 있어요.
      </div>
    );
  }

  const closureBy = new Map<string, Closure>(r.closures.map((c) => [c.date, c]));

  const toggle = (date: string, meal: MealType) => {
    if (mealLocked(date, meal, r.today, r.nowMin)) return;
    if (!mealAvailable(date, dowOf(date), meal, closureBy)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(date, meal);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const countOf = (meal: MealType) => {
    let n = 0;
    for (const k of selected) if (k.endsWith(`|${meal}`)) n++;
    for (const k of lockedApplied) if (k.endsWith(`|${meal}`)) n++;
    return n;
  };
  const lunchCount = countOf("lunch");
  const dinnerCount = countOf("dinner");
  const total = lunchCount * r.month.lunch_price + dinnerCount * r.month.dinner_price;

  const save = () => {
    setSaveErr(null);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    fd.set("tab", tab);
    if (identity._test) fd.set("test", "1");
    const meals = [...selected].map((k) => {
      const i = k.lastIndexOf("|");
      return { date: k.slice(0, i), meal_type: k.slice(i + 1) as MealType };
    });
    fd.set("meals", JSON.stringify(meals));
    startSave(async () => {
      const res = await saveLunchOrder(fd);
      if (res.ok) {
        setOriginal(new Set(selected));
        setToast(true);
        setTimeout(() => setToast(false), 2200);
      } else if (res.kind === "identity") {
        onExpired();
      } else {
        setSaveErr(res.error);
        load(); // 서버·클라 판정이 어긋난 경우(마감 재검증 실패 등) 최신 상태로 다시 맞춘다.
      }
    });
  };

  return (
    <div>
      <NoticeBox notice={r.month.notice} />
      <MealGrid
        year={r.month.year}
        month={r.month.month}
        today={r.today}
        nowMin={r.nowMin}
        closureBy={closureBy}
        selected={selected}
        lockedApplied={lockedApplied}
        onToggle={toggle}
      />
      {saveErr && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, marginTop: 14 }}>{saveErr}</div>}
      <SummaryBar
        lunchLabel={r.month.lunch_label}
        dinnerLabel={r.month.dinner_label}
        lunchCount={lunchCount}
        dinnerCount={dinnerCount}
        total={total}
        dirty={dirty}
        saving={saving}
        onSave={save}
      />
      {toast && <Toast text="저장됐어요" />}
    </div>
  );
}

// ---------------- 안내 ----------------
function NoticeBox({ notice }: { notice: string | null }) {
  const lines = noticeLines(notice);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)", padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)" }}>도시락은 4층에서 받아 가세요.</div>
      <div style={{ fontSize: 12.5, color: "var(--sub)" }}>당일 오전 8시 전까지 신청·취소할 수 있어요.</div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 12.5, color: "var(--dim)" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

// ---------------- 격자 ----------------
function MealGrid({
  year, month, today, nowMin, closureBy, selected, lockedApplied, onToggle,
}: {
  year: number; month: number; today: string; nowMin: number;
  closureBy: Map<string, Closure>; selected: Set<MealKey>; lockedApplied: Set<MealKey>;
  onToggle: (date: string, meal: MealType) => void;
}) {
  const rows = useMemo(() => monthGrid(year, month), [year, month]);
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{monthLabel(year, month)}</div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 6 * 36 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(36px, 1fr))", gap: 4, marginBottom: 4 }}>
            {DAY_LABELS.map((label) => (
              <div key={label} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "var(--faint)", padding: "2px 0" }}>
                {label}
              </div>
            ))}
          </div>
          {rows.map((row, ri) => (
            <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(36px, 1fr))", gap: 4, marginBottom: 4 }}>
              {row.slice(0, 6).map((cell, ci) => (
                <DayCell
                  key={ci}
                  cell={cell}
                  today={today}
                  nowMin={nowMin}
                  closureBy={closureBy}
                  selected={selected}
                  lockedApplied={lockedApplied}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCell({
  cell, today, nowMin, closureBy, selected, lockedApplied, onToggle,
}: {
  cell: GridDay; today: string; nowMin: number; closureBy: Map<string, Closure>;
  selected: Set<MealKey>; lockedApplied: Set<MealKey>; onToggle: (date: string, meal: MealType) => void;
}) {
  if (!cell) return <div />;
  const closure = effectiveClosure(cell.iso, cell.dow, closureBy);
  const isToday = cell.iso === today;
  return (
    <div
      style={{
        border: "1px solid var(--line)", borderRadius: 8, padding: "4px 3px 5px",
        background: isToday ? "var(--accent-soft)" : "var(--card)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? "var(--accent)" : "var(--sub)", textAlign: "center", marginBottom: 3 }}>
        {cell.day}
      </div>
      {closure && closure.lunch_closed && closure.dinner_closed ? (
        <div style={{ fontSize: 9, color: "var(--faint)", textAlign: "center", padding: "8px 0", lineHeight: 1.3 }}>
          {closure.label || "휴무"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <MealCell iso={cell.iso} meal="lunch" label="중" today={today} nowMin={nowMin} closure={closure} selected={selected} lockedApplied={lockedApplied} onToggle={onToggle} />
          <MealCell iso={cell.iso} meal="dinner" label="석" today={today} nowMin={nowMin} closure={closure} selected={selected} lockedApplied={lockedApplied} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}

function MealCell({
  iso, meal, label, today, nowMin, closure, selected, lockedApplied, onToggle,
}: {
  iso: string; meal: MealType; label: string; today: string; nowMin: number;
  closure: { lunch_closed: boolean; dinner_closed: boolean; label: string } | null;
  selected: Set<MealKey>; lockedApplied: Set<MealKey>; onToggle: (date: string, meal: MealType) => void;
}) {
  const closed = closure ? (meal === "lunch" ? closure.lunch_closed : closure.dinner_closed) : false;
  const k = keyOf(iso, meal);
  const locked = mealLocked(iso, meal, today, nowMin);
  const applied = selected.has(k) || lockedApplied.has(k);
  const disabled = closed || locked;

  let bg = "var(--card)";
  let bd = "var(--line)";
  let fg = "var(--faint)";
  if (closed) {
    bg = "var(--panel2)";
    bd = "var(--line)";
  } else if (applied) {
    bg = locked ? "var(--panel2)" : "var(--accent-soft)";
    bd = locked ? "var(--line)" : "var(--accent)";
    fg = locked ? "var(--dim)" : "var(--accent)";
  } else if (locked) {
    bg = "var(--panel2)";
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(iso, meal)}
      aria-pressed={applied}
      aria-label={`${label}식 ${applied ? "신청됨" : "미신청"}${locked ? " (마감)" : closed ? " (휴무)" : ""}`}
      style={{
        height: 36, minHeight: 36, borderRadius: 6, border: `1px solid ${bd}`, background: bg, color: fg,
        fontSize: 10, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 2, padding: 0,
        opacity: closed ? 0.55 : 1,
      }}
    >
      {closed ? null : locked ? (
        applied ? (
          <>
            <DotIcon /> <LockTinyIcon />
          </>
        ) : (
          <LockTinyIcon />
        )
      ) : applied ? (
        <DotIcon />
      ) : (
        label
      )}
    </button>
  );
}

// ---------------- 요약 바 ----------------
function SummaryBar({
  lunchLabel, dinnerLabel, lunchCount, dinnerCount, total, dirty, saving, onSave,
}: {
  lunchLabel: string; dinnerLabel: string; lunchCount: number; dinnerCount: number; total: number;
  dirty: boolean; saving: boolean; onSave: () => void;
}) {
  return (
    <div
      style={{
        position: "sticky", bottom: 0, marginTop: 18, paddingTop: 12, borderTop: "1px solid var(--line)",
        background: "var(--card)", display: "flex", alignItems: "center", gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--sub)", fontWeight: 700 }}>
          {lunchLabel} {lunchCount} · {dinnerLabel} {dinnerCount}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>합계 {won(total)}</div>
      </div>
      <button
        type="button"
        className="btn btn-accent"
        disabled={!dirty || saving}
        onClick={onSave}
        style={{ height: 48, padding: "0 22px", fontSize: 14.5, fontWeight: 700, flex: "none" }}
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 60,
        background: "var(--ink)", color: "#fff", fontSize: 13, fontWeight: 700,
        padding: "10px 18px", borderRadius: 999, boxShadow: "0 10px 30px rgba(20,22,30,.25)",
      }}
    >
      {text}
    </div>
  );
}

// ---------------- 아이콘 ----------------
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function LockSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function LockTinyIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
