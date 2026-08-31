"use client";

// 도시락 신청 폼 — 월 격자(주차 × 월~토) 안에서 날짜마다 중식/석식을 켜고 끄는 화면. 완료 화면으로
// 튕기지 않고 계속 남아 수정할 수 있다(스케쥴 위저드와 다른 점 — 도시락은 "제출"이 아니라 "상태 저장").
// 격자·휴무 규칙·마감 판정은 전부 src/lib/lunch.ts 의 순수 함수를 그대로 쓴다(재발명 금지) — 이 화면과
// 서버 액션(lunch-actions.ts)이 같은 함수를 써야 클라·서버 판정이 어긋나지 않는다.
import { useEffect, useMemo, useState, useTransition } from "react";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { LockPopup } from "../../_shared/LockedInfo";
import { useIdentity, useRedirectIfNoIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import {
  effectiveClosure, mealAvailable, mealLocked, dowOf, won, monthLabel, noticeLines,
  type Closure, type MealType,
} from "@/lib/lunch";
import MealGrid from "../../../_shared/MealGrid";
import { getLunchData, saveLunchOrder, type Tab, type LunchDataResult } from "./lunch-actions";

type ReadyData = Extract<LunchDataResult, { ok: true }>;
type MealKey = string; // `${date}|${meal}`
const keyOf = (date: string, meal: MealType): MealKey => `${date}|${meal}`;
const setsEqual = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((v) => b.has(v));

export default function LunchForm({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const hubSlug = getHubSlug();
  useRedirectIfNoIdentity(hydrated, identity, hubSlug);
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<Tab>("current");
  const [nextOpen, setNextOpen] = useState<boolean | null>(null);
  const [lockLines, setLockLines] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);

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
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{monthLabel(r.month.year, r.month.month)}</div>
      <MealGrid
        year={r.month.year}
        month={r.month.month}
        today={r.today}
        closureBy={closureBy}
        appliedSet={new Set([...selected, ...lockedApplied])}
        lockedSet={lockedApplied}
        onMealClick={(date, meal) => toggle(date, meal)}
        isMealDisabled={(date, meal, closure, locked) => {
          const closed = closure ? (meal === "lunch" ? closure.lunch_closed : closure.dinner_closed) : false;
          return closed || locked;
        }}
        legendExtra="칸을 눌러 신청·취소하세요"
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
