"use client";

// 도시락 신청 폼 — 월 격자(주차 × 월~토) 안에서 날짜마다 중식/석식을 켜고 끄는 화면. 신청이 성공하면
// 완료 화면으로 전환되고(홈으로 / 계속 수정하기), 마감(당일 오전 8시) 전까지는 계속 수정하기로 돌아와
// 다시 신청할 수 있다.
// 격자·휴무 규칙·마감 판정은 전부 src/lib/lunch.ts 의 순수 함수를 그대로 쓴다(재발명 금지) — 이 화면과
// 서버 액션(lunch-actions.ts)이 같은 함수를 써야 클라·서버 판정이 어긋나지 않는다.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity, useRedirectIfNoIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { useScrollFocusOn } from "../../_shared/useScrollFocus";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import {
  effectiveClosure, mealAvailable, mealLocked, dowOf, won, monthLabel, noticeLines,
  daysInMonth, isoDate, MEAL_LOCK_HOUR_MIN,
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
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(false);

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

          {!done && <TabsBar tab={tab} onSelect={setTab} />}

          <MonthPanel
            key={tab}
            tab={tab}
            identity={identity}
            slug={def.slug}
            hubSlug={hubSlug}
            done={done}
            onExpired={onExpired}
            onDirtyChange={setDirty}
            onDoneChange={setDone}
          />
        </>
      )}
    </FormShell>
  );
}

// ---------------- 탭 ----------------
// 다음 달 탭은 날짜 제한 없이 항상 열려 있다(25일 규칙 폐지) — 아직 준비 안 된 달은 가격 미설정
// 안내(PriceUnsetNotice)가 탭을 연 뒤 그 안에서 막는다.
function TabsBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
      <TabButton active={tab === "current"} onClick={() => onSelect("current")}>
        이번 달
      </TabButton>
      <TabButton active={tab === "next"} onClick={() => onSelect("next")}>
        다음 달
      </TabButton>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, height: 44, borderRadius: 12, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--card)",
        color: active ? "var(--accent)" : "var(--ink)",
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
  tab, identity, slug, hubSlug, done, onExpired, onDirtyChange, onDoneChange,
}: {
  tab: Tab;
  identity: StoredIdentity;
  slug: string;
  hubSlug: string;
  done: boolean;
  onExpired: () => void;
  onDirtyChange: (v: boolean) => void;
  onDoneChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  // selected/original 은 사용자가 편집하는 값이라 state 로 둔다. priceMap/appliedLocked/lockedAll 은
  // state.data 의 순수 파생값이라 아래 useMemo 로 뽑는다(별도 state 로 들면 동기화 실수 여지만 생긴다).
  const [selected, setSelected] = useState<Set<MealKey>>(new Set());
  const [original, setOriginal] = useState<Set<MealKey>>(new Set());
  const [saving, startSave] = useTransition();
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(doneRef, [done]);

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
      const unlocked = new Set<MealKey>();
      for (const m of r.myMeals) {
        if (!mealLocked(m.date, m.meal_type, r.today, r.nowMin)) unlocked.add(keyOf(m.date, m.meal_type));
      }
      setSelected(new Set(unlocked));
      setOriginal(unlocked);
      setSaveErr(null);
      setState({ phase: "ready", data: r });
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [tab]);

  const dirty = useMemo(() => !setsEqual(selected, original), [selected, original]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // 저장 직전에 이미 낸 신청이 있었는지 — 완료 화면 문구를 "신청됐습니다"/"수정됐습니다"로 가른다.
  // 저장에 성공하면 original 이 갱신되므로 저장 후 값으로는 판단할 수 없어 그 순간을 붙잡아 둔다.
  const [savedAsEdit, setSavedAsEdit] = useState(false);

  // priceMap: 저장된 끼니의 단가 스냅샷(lm.price, 관리자 화면 actions.ts listApps 과 같은 원칙).
  // appliedLocked: 마감 & 이미 신청됨(dot 표시용). lockedAll: 이 달의 모든 잠긴 끼니(그리드 톤·비활성용,
  // 신청 여부 무관 — 한 번도 신청 안 한 과거 날짜도 잠긴 것으로 보여야 한다).
  const { priceMap, appliedLocked, lockedAll } = useMemo(() => {
    if (state.phase !== "ready") {
      return { priceMap: new Map<MealKey, number>(), appliedLocked: new Set<MealKey>(), lockedAll: new Set<MealKey>() };
    }
    const r = state.data;
    const appliedLockedSet = new Set<MealKey>();
    const priceMapNext = new Map<MealKey, number>();
    for (const m of r.myMeals) {
      const k = keyOf(m.date, m.meal_type);
      priceMapNext.set(k, m.price);
      if (mealLocked(m.date, m.meal_type, r.today, r.nowMin)) appliedLockedSet.add(k);
    }
    const lockedAllSet = new Set<MealKey>();
    for (let d = 1; d <= daysInMonth(r.month.year, r.month.month); d++) {
      const iso = isoDate(r.month.year, r.month.month, d);
      for (const meal of ["lunch", "dinner"] as MealType[]) {
        if (mealLocked(iso, meal, r.today, r.nowMin)) lockedAllSet.add(keyOf(iso, meal));
      }
    }
    return { priceMap: priceMapNext, appliedLocked: appliedLockedSet, lockedAll: lockedAllSet };
  }, [state]);

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

  if (done) {
    return (
      <div ref={doneRef} style={{ textAlign: "center", padding: "12px 4px 4px" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <CheckIcon />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{savedAsEdit ? "수정됐습니다" : "신청됐습니다"}</div>
        <div style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.6, marginBottom: 20 }}>
          당일 오전 8시 전까지는 이 페이지에서 다시 들어와 신청 내용을 바꿀 수 있어요.
          <br />
          8시가 지난 끼니는 더 이상 신청·취소할 수 없어요.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Link
            href={`/f/${hubSlug}`}
            className="btn btn-accent"
            style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
          >
            홈으로
          </Link>
          <button
            type="button"
            className="btn"
            onClick={() => onDoneChange(false)}
            style={{ height: 48, fontSize: 14.5, fontWeight: 700, width: "100%" }}
          >
            계속 수정하기
          </button>
        </div>
      </div>
    );
  }

  const closureBy = new Map<string, Closure>(r.closures.map((c) => [c.date, c]));
  // 가격 미설정은 달 전체(둘 다 0)가 아니라 끼니별로 본다 — 중식만 0원인 달이면 중식만 막고 석식은
  // 정상 신청된다. 새 신청 추가만 막고 기존 취소는 허용한다. 서버(lunch-actions.ts)도 같은
  // 판정(끼니별 price===0, existingSet 기준 집합 비교)을 쓴다.
  const lunchPriceUnset = r.month.lunch_price === 0;
  const dinnerPriceUnset = r.month.dinner_price === 0;
  const priceUnsetOf = (meal: MealType) => (meal === "lunch" ? lunchPriceUnset : dinnerPriceUnset);

  const toggle = (date: string, meal: MealType) => {
    if (mealLocked(date, meal, r.today, r.nowMin)) return;
    const k = keyOf(date, meal);
    // 신청한 뒤 관리자가 휴무로 바꾼 날 — 새로 신청(추가)은 막되, "원래(이번 편집 세션을
    // 시작할 때) 신청돼 있던" 칸은 이번 세션 동안 자유롭게 켜고 끌 수 있다(오탭으로 취소해도 되돌릴
    // 수 있어야 한다 — original 기준으로 판단하므로 몇 번을 껐다 켜도 서버의 "새로 추가되는 휴무만
    // 거부" 규칙과 어긋나지 않는다. existingSet 도 같은 시점 기준이다). mealAvailable 자체(순수 함수,
    // 서버와 공유)는 건드리지 않고 이 호출부에서 "적용 범위"만 좁힌다.
    if (!mealAvailable(date, dowOf(date), meal, closureBy)) {
      if (!original.has(k)) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
      return;
    }
    const adding = !selected.has(k);
    // 서버(existingSet)와 같은 기준: "원래(저장돼 있던) 끼니"를 세션 중 껐다 다시 켜는 것은 새 신청이
    // 아니다 — original 기준으로 판단해야, 저장 전 상태로 돌아가는 것마저 막는 일이 없다.
    if (adding && !original.has(k) && priceUnsetOf(meal)) return; // 가격 미정 끼니엔 새 신청 불가 — 취소는 그대로 허용
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const countOf = (meal: MealType) => {
    let n = 0;
    for (const k of selected) if (k.endsWith(`|${meal}`)) n++;
    for (const k of appliedLocked) if (k.endsWith(`|${meal}`)) n++;
    return n;
  };
  const lunchCount = countOf("lunch");
  const dinnerCount = countOf("dinner");
  // 총액은 이미 저장된 끼니는 저장 시점 단가 스냅샷(priceMap, lm.price)으로, 이번 세션에
  // 새로 고른(아직 저장 안 된) 끼니만 현재 월 가격으로 계산한다 — 관리자 화면(actions.ts listApps)과
  // 같은 원칙이라 가격을 바꿔도 학생 화면·관리 화면 총액이 어긋나지 않는다.
  let total = 0;
  for (const k of new Set([...selected, ...appliedLocked])) {
    const saved = priceMap.get(k);
    if (saved !== undefined) {
      total += saved;
    } else {
      const meal = k.slice(k.lastIndexOf("|") + 1) as MealType;
      total += meal === "lunch" ? r.month.lunch_price : r.month.dinner_price;
    }
  }

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
        setSavedAsEdit(original.size > 0 || appliedLocked.size > 0);
        setOriginal(new Set(selected));
        onDoneChange(true);
      } else if (res.kind === "identity") {
        onExpired();
      } else {
        setSaveErr(res.error);
        load(); // 서버·클라 판정이 어긋난 경우(마감 재검증 실패 등) 최신 상태로 다시 맞춘다.
      }
    });
  };

  // 오늘은 항상 "이번 달" 탭 안에 있다 — 남은 시간 안내도 그 탭에서만 뜻이 있다.
  const minutesLeft = tab === "current" ? MEAL_LOCK_HOUR_MIN - r.nowMin : null;

  return (
    <div>
      <NoticeBox notice={r.month.notice} minutesLeft={minutesLeft} />
      {/* 안내 배너는 둘 다 미설정일 때만 */}
      {lunchPriceUnset && dinnerPriceUnset && <PriceUnsetNotice />}
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{monthLabel(r.month.year, r.month.month)}</div>
      <MealGrid
        year={r.month.year}
        month={r.month.month}
        today={r.today}
        closureBy={closureBy}
        appliedSet={new Set([...selected, ...appliedLocked])}
        lockedSet={lockedAll}
        onMealClick={(date, meal) => toggle(date, meal)}
        isMealDisabled={(date, meal, closure, locked) => {
          if (locked) return true;
          const closed = closure ? (meal === "lunch" ? closure.lunch_closed : closure.dinner_closed) : false;
          if (!closed) return false;
          // 휴무인 칸은 원칙적으로 클릭 불가지만, "원래(이번 편집 세션 시작 시점에) 신청돼
          // 있던" 칸만은 계속 눌리게 둔다 — toggle 이 그 경우 켜고 끄기를 모두 허용하므로(되돌리기),
          // 여기서도 selected 가 아니라 original 로 판단해야 취소 후 다시 켤 때 막히지 않는다.
          return !original.has(keyOf(date, meal));
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
        editing={original.size > 0 || appliedLocked.size > 0}
      />
    </div>
  );
}

// ---------------- 안내 ----------------
// 남은 시간은 서버가 요청 시점에 내려준 nowMin 스냅샷으로 한 번만 계산한다(클라에서 new Date() 금지
// 원칙) — 화면을 오래 열어두면 낡으므로, 정확한 분 단위 대신 10분 단위로 내림해 "약" 을 붙인다.
// 올림하면 마감을 넘긴 뒤에도 "시간 남음"이라 오도할 수 있어 내림만 쓴다.
function timeLeftLabel(minutesLeft: number): string | null {
  if (minutesLeft <= 0) return null;
  const bucket = Math.floor(minutesLeft / 10) * 10;
  if (bucket <= 0) return "곧 마감돼요";
  const h = Math.floor(bucket / 60);
  const m = bucket % 60;
  const parts = [h > 0 ? `${h}시간` : "", m > 0 ? `${m}분` : ""].filter(Boolean).join(" ");
  return `약 ${parts} 남았어요`;
}

function NoticeBox({ notice, minutesLeft }: { notice: string | null; minutesLeft: number | null }) {
  const lines = noticeLines(notice);
  const timeLeft = minutesLeft === null ? null : timeLeftLabel(minutesLeft);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)", padding: "12px 14px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)" }}>도시락은 4층에서 받아 가세요.</div>
      <div style={{ fontSize: 12.5, color: "var(--sub)" }}>당일 오전 8시 전까지 신청·취소할 수 있어요.</div>
      {timeLeft && <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>오늘 신청 마감까지 {timeLeft}</div>}
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 12.5, color: "var(--dim)" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

// ---------------- 가격 미설정 안내 ----------------
function PriceUnsetNotice() {
  return (
    <div
      style={{
        border: "1px solid var(--danger-strong)", borderRadius: 12, background: "var(--panel2)",
        padding: "12px 14px", marginBottom: 16, fontSize: 12.5, color: "var(--danger-strong)", fontWeight: 700, lineHeight: 1.6,
      }}
    >
      이 달은 아직 가격이 정해지지 않았어요. 새 신청은 할 수 없어요 — 카운터에 문의해주세요.
    </div>
  );
}

// ---------------- 요약 바 ----------------
// editing: 이 달에 이미 낸 신청이 있으면 버튼이 "신청"이 아니라 "신청 수정"이 된다 —
// 처음 내는 것인지 고치는 것인지 헷갈리지 않게.
function SummaryBar({
  lunchLabel, dinnerLabel, lunchCount, dinnerCount, total, dirty, saving, onSave, editing,
}: {
  lunchLabel: string; dinnerLabel: string; lunchCount: number; dinnerCount: number; total: number;
  dirty: boolean; saving: boolean; onSave: () => void; editing: boolean;
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
        {saving ? (editing ? "수정 중…" : "신청 중…") : editing ? "신청 수정" : "신청"}
      </button>
    </div>
  );
}

// ---------------- 아이콘 ----------------
function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
