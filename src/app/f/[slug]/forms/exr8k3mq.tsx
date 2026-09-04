"use client";

// 일정 변경 신청 폼 — 정기 스케쥴(schedule_rule/schedule_hours)과 별개로 학생이 신청하면 관리자가
// 승인해야 반영된다(지점 설정에 따라 자동 승인도 가능). 정기 입력 기간(schedule_window/schedule_grant)과
// 무관하게 언제나 열려 있다 — 수정이 아니라 신청이라서.
// 저장은 schedule_request 에 직접(전용 액션: schedule-request-actions.ts) — f/actions.ts 의
// submitForm/submission 을 쓰지 않는다.
//
// 신청 갈래(reqKind, src/lib/schedule.ts REQUEST_KINDS 가 단일 출처) 3가지:
// - temp: 특정 날짜 하루만 바뀜(기존, 5유형 absent/late/early/out/custom).
// - rule_edit: 기존 정기 규칙 하나의 요일/시간/사유를 바꾸는 신청(승인되면 schedule_rule 실제 수정).
// - rule_delete: 기존 정기 규칙 하나를 영구 삭제하는 신청(승인되면 그 행 삭제).
// 무엇을 신청할지 고르기 전에는 입력 영역이 뜨지 않는다(단계형 진행) — 아래에서 reqKind, temp 안에서는
// 다시 reqType(5유형)을 고르기 전까지 시간 입력을 숨긴다.
//
// 숫자 입력 원칙(11→01 버그 재발 방지): onChange 는 숫자 필터+slice(-2) 만, 정규화(0패딩)는 blur 에서
// e.currentTarget.value 를 읽어서, 포커스 시 select(), 자동 포커스 이동은 커밋(리렌더) 이후인
// useEffect 에서(sch9m2vt.tsx/ScheduleDemo.tsx 와 같은 패턴).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { InfoPopup } from "../../_shared/LockedInfo";
import { useIdentity, useRedirectIfNoIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { useScrollFocusOn } from "../../_shared/useScrollFocus";
import { getHubSlug, getFormSlugByType } from "../../registry";
import type { FormDef } from "../../registry";
import {
  SCHEDULE_REASONS, blockStyleOf,
  REQUEST_TYPES, type RequestType, type RequestTypeRawInput, type ResolvedRange, resolveRequestRange, requestTypeOf,
  REQUEST_KINDS, type RequestKind, nearestToBase,
} from "@/lib/schedule";
import {
  getDateBounds, getDayRules, getMySchedule, createRequests, listMyRequests, cancelRequest,
  type DayRuleRow, type MyHoursRow, type MyRuleRow, type MyRequestRow,
  type RequestItemInput, type TempItemInput, type RuleEditItemInput, type RuleDeleteItemInput,
} from "./schedule-request-actions";
// 스케쥴 입력이 재개방(관리자 활성화)됐는지 확인 — Hub.tsx 가 허브 카드에 쓰는 것과 같은 서버액션을
// 그대로 재사용한다(로직 재발명 금지). "첫 제출 전"(reason=first)은 신규 학생의 정상 상태라 안내 대상이
// 아니고, "관리자가 다시 열어줌"(reason=grant)만 "새 스케쥴을 내주세요" 안내 대상이다(2026-09-01).
import { checkScheduleWindow } from "./schedule-window-actions";

type HM = { h: string; m: string };
const emptyHM = (): HM => ({ h: "", m: "" });
const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]; // index+1 = schedule_rule.days 좌표(1..7)
// "유형" 타일에 실제로 보여줄 목록 — arrive_early/leave_late 는 hours 카드가 방향에 따라 대신 골라
// 제출하는 결과 유형일 뿐, 학생이 직접 고르는 타일이 아니다(REQUEST_TYPES 에는 라벨용으로 남아있다).
const CARD_TILE_TYPES = REQUEST_TYPES.filter((t) => t.key !== "arrive_early" && t.key !== "leave_late");

function parseHM(v: HM): number | null {
  if (v.h === "" || v.m === "") return null;
  const h = clampInt(parseInt(v.h, 10) || 0, 0, 23);
  const m = clampInt(parseInt(v.m, 10) || 0, 0, 59);
  return h * 60 + m;
}
function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function fmtLeave(min: number): string {
  return min >= 1440 ? `다음날 ${fmtMin(min)}` : fmtMin(min);
}
/** "YYYY-MM-DD" → "8월 21일"(순수 문자열 계산, Date 객체·로케일 변환 없음). */
function mdLabel(date: string): string {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
}
let seq = 0;
const uid = () => "rq" + Date.now().toString(36) + ++seq;

const statusChip: Record<MyRequestRow["status"], { label: string; fg: string; bg: string }> = {
  pending: { label: "대기", fg: "var(--warn)", bg: "var(--warn-soft)" },
  approved: { label: "승인", fg: "var(--accent)", bg: "var(--accent-soft)" },
  rejected: { label: "반려", fg: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 12%, transparent)" },
};

export default function ScheduleRequestForm({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const hubSlug = getHubSlug();
  useRedirectIfNoIdentity(hydrated, identity, hubSlug);

  const [expired, setExpired] = useState(false);
  // 신청 갈래(reqKind)를 고르거나 카드에 뭔가 입력했으면 true — 상단 "‹ 홈" 확인 여부에 쓰인다.
  const [dirty, setDirty] = useState(false);

  return (
    <FormShell title={def.title} subtitle={def.intro} maxWidth={520} backHref={`/f/${hubSlug}`} confirmLeave={dirty}>
      {!hydrated || !identity ? null : expired ? (
        <IdentityExpired hubSlug={hubSlug} />
      ) : (
        <Wizard identity={identity} hubSlug={hubSlug} onExpired={() => { clear(); setExpired(true); }} onDirtyChange={setDirty} />
      )}
    </FormShell>
  );
}

// ==================== 신청 카드(임시 변경, 제출 전 임시 항목) ====================
type DraftCard = {
  id: string;
  date: string;
  reqType: RequestType | null; // 고르기 전엔 null — 그때까지 날짜 아래 입력을 보여주지 않는다.
  reasonKey: string;
  title: string;
  // t1/t2 의미는 reqType 에 따라 다르다: late=등원 시각(t1), early=하원 시각(t1),
  // out=나가는 시각(t1)/돌아오는 시각(t2), custom=시작(t1)/종료(t2), hours=새 등원 시각(t1, 선택)/새
  // 하원 시각(t2, 선택, 둘 중 하나는 있어야 함). absent 는 미사용.
  t1: HM;
  t2: HM;
  mode: "add" | "replace";
  skipRuleId: string | null;
  overlap: DayRuleRow[] | null; // null=아직 안 물어봄
  hours: { arrive: number; leave: number } | null; // 그 날짜(요일)의 정기 등·하원 시각(없으면 휴무·미제출)
  dayLoading: boolean;
};
function newCard(): DraftCard {
  return {
    id: uid(), date: "", reqType: null, reasonKey: SCHEDULE_REASONS[0].key, title: "",
    t1: emptyHM(), t2: emptyHM(), mode: "add", skipRuleId: null,
    overlap: null, hours: null, dayLoading: false,
  };
}

/** 카드의 현재 입력을 resolveRequestRange 가 받는 원값(raw) 형태로 만든다. 아직 다 안 채워졌으면 null. */
function rawInputOf(card: DraftCard): RequestTypeRawInput | null {
  if (!card.reqType) return null;
  switch (card.reqType) {
    case "absent":
      return { type: "absent" };
    case "late": {
      const arrive = parseHM(card.t1);
      return arrive == null ? null : { type: "late", arrive };
    }
    case "early": {
      const leave = parseHM(card.t1);
      return leave == null ? null : { type: "early", leave };
    }
    case "out": {
      const leaveAt = parseHM(card.t1);
      const returnAt = parseHM(card.t2);
      return leaveAt == null || returnAt == null ? null : { type: "out", leaveAt, returnAt };
    }
    case "custom": {
      const start = parseHM(card.t1);
      const end = parseHM(card.t2);
      return start == null || end == null ? null : { type: "custom", start, end };
    }
    // hours 는 단일 range 가 아니라 등원·하원 최대 2건으로 쪼개진다 — hoursArriveItem/hoursLeaveItem 이
    // 대신 만든다(아래). arrive_early/leave_late 는 그렇게 쪼개진 "결과"로만 존재해 카드가 직접 이
    // reqType 을 갖지 않는다(REQUEST_TYPES 에는 라벨용으로 있지만 카드 타일에는 안 보인다).
    case "hours":
    case "arrive_early":
    case "leave_late":
      return null;
  }
}

/** 미리보기 계산 — 최종 확정은 서버(createRequests)가 원값을 그대로 다시 계산한다(클라 값 신뢰 금지). */
function resolvedOf(card: DraftCard): ResolvedRange | null {
  const raw = rawInputOf(card);
  if (!raw) return null;
  const hours = card.hours ? { arrive_min: card.hours.arrive, leave_min: card.hours.leave } : null;
  return resolveRequestRange(raw, hours);
}

/** hours 카드 한 장에서 나올 수 있는 신청 항목(최대 2건: 등원 변경 1건 + 하원 변경 1건) 중 하나.
 * 방향(늦게/일찍)은 그 날짜의 정기 시각(card.hours) 과 비교해 여기서 정하고, 서버는 이 reqType 이
 * 실제로 그 방향인지(예: arrive_early 인데 원래보다 안 이르면) 다시 검증한다(resolveRequestRange 가
 * late/early 와 완전히 같은 방식으로 거부한다 — 클라 판정 신뢰 금지 원칙 그대로). */
type HoursItem = { reqType: RequestType; raw: RequestTypeRawInput; resolved: ResolvedRange };

/** t1(새 등원 시각) 이 비어 있으면 null(그 필드는 안 바꾸는 것) — 원래 등원 시각(card.hours.arrive)보다
 * 늦으면 late(기존 유형 재사용), 이르면 arrive_early(새 유형)로 나뉜다. */
function hoursArriveItem(card: DraftCard): HoursItem | null {
  if (!card.hours) return null;
  const newArrive = parseHM(card.t1);
  if (newArrive == null) return null;
  const hours = { arrive_min: card.hours.arrive, leave_min: card.hours.leave };
  const raw: RequestTypeRawInput =
    newArrive > card.hours.arrive ? { type: "late", arrive: newArrive } : { type: "arrive_early", arrive: newArrive };
  return { reqType: raw.type, raw, resolved: resolveRequestRange(raw, hours) };
}

/** t2(새 하원 시각) 이 비어 있으면 null. 자정 넘김 판정은 nearestToBase(서버와 같은 함수)로 — 원래
 * 하원 시각보다 이르면 early(기존 유형 재사용), 늦으면 leave_late(새 유형)로 나뉜다. */
function hoursLeaveItem(card: DraftCard): HoursItem | null {
  if (!card.hours) return null;
  const newLeaveRaw = parseHM(card.t2);
  if (newLeaveRaw == null) return null;
  const hours = { arrive_min: card.hours.arrive, leave_min: card.hours.leave };
  const adjusted = nearestToBase(newLeaveRaw, card.hours.leave);
  const raw: RequestTypeRawInput =
    adjusted >= card.hours.leave ? { type: "leave_late", leave: newLeaveRaw } : { type: "early", leave: newLeaveRaw };
  return { reqType: raw.type, raw, resolved: resolveRequestRange(raw, hours) };
}

function overlapsOf(card: DraftCard): DayRuleRow[] {
  if (!card.overlap || card.overlap.length === 0) return [];
  if (card.reqType === "hours") {
    const ranges = [hoursArriveItem(card), hoursLeaveItem(card)]
      .filter((it): it is HoursItem => !!it && it.resolved.ok)
      .map((it) => it.resolved as Extract<ResolvedRange, { ok: true }>);
    if (ranges.length === 0) return [];
    return card.overlap.filter((r) => ranges.some((res) => res.start < r.end && r.start < res.end));
  }
  const resolved = resolvedOf(card);
  if (!resolved || !resolved.ok) return [];
  return card.overlap.filter((r) => resolved.start < r.end && r.start < resolved.end);
}

// ==================== 메인 위저드 ====================
function Wizard({
  identity, hubSlug, onExpired, onDirtyChange,
}: { identity: StoredIdentity; hubSlug: string; onExpired: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [bounds, setBounds] = useState<{ today: string; maxDate: string } | null>(null);
  const [mySchedule, setMySchedule] = useState<{ hours: MyHoursRow[]; rules: MyRuleRow[] } | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequestRow[] | null>(null);
  const [reqKind, setReqKind] = useState<RequestKind | null>(null);
  const [cards, setCards] = useState<DraftCard[]>([newCard()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [submitTick, setSubmitTick] = useState(0); // 성공 제출마다 +1 — 결과 목록 스크롤-포커스 트리거 전용.
  const [submittedOnce, setSubmittedOnce] = useState(false); // 신청이 한 번이라도 성공했는지 — "홈으로" 버튼 노출 트리거.

  // 스케쥴 입력이 관리자 활성화로 다시 열려 있는지 — 열려 있으면(재개방) 새 스케쥴을 낼 수 있다고
  // 안내한다. false=닫힘/첫 제출 전(안내 대상 아님), true=재개방(안내 대상), null=확인 전.
  const [scheduleReopened, setScheduleReopened] = useState<boolean | null>(null);
  const [showReopenPopup, setShowReopenPopup] = useState(false);
  const scheduleSlug = getFormSlugByType("schedule");
  const seenKey = `f:scheduleReopenSeen:${identity.studentId}`;

  // temp 갈래는 카드에 실제로 뭔가 넣었는지까지 보고, rule_edit/rule_delete 는 갈래를 고른 순간부터
  // "작성 중"으로 본다(대상 정기 일정을 고르는 것 자체가 신청 준비 단계라서).
  useEffect(() => {
    const d = reqKind === "temp"
      ? cards.some((c) => !!c.date || !!c.reqType || c.title.trim() !== "")
      : reqKind !== null;
    onDirtyChange(d);
  }, [reqKind, cards, onDirtyChange]);

  // 신청 갈래를 고르면 그 갈래의 입력 영역으로, 성공 제출 후에는 "내 신청 목록" 으로 스크롤-포커스한다.
  const flowRef = useRef<HTMLDivElement>(null);
  const myRequestsRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(flowRef, [reqKind]);
  useScrollFocusOn(myRequestsRef, [submitTick], { focus: false });

  const idFD = (): FormData => {
    const fd = new FormData();
    fd.set("slug", "exr8k3mq");
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    return fd;
  };

  const reloadMine = () => {
    listMyRequests(idFD()).then((r) => {
      if (!r.ok) {
        if (r.kind === "identity") onExpired();
        return;
      }
      setMyRequests(r.rows);
    });
  };
  const reloadMySchedule = () => {
    getMySchedule(idFD()).then((r) => {
      if (!r.ok) {
        if (r.kind === "identity") onExpired();
        return;
      }
      setMySchedule({ hours: r.hours, rules: r.rules });
    });
  };

  useEffect(() => {
    getDateBounds().then(setBounds);
    reloadMine();
    reloadMySchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scheduleSlug) return;
    let alive = true;
    checkScheduleWindow(idFD()).then((r) => {
      if (!alive) return;
      setScheduleReopened(r.ok && r.state.open && r.state.reason === "grant");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSlug]);

  // 재개방을 확인했고, 이번 세션(sessionStorage)에서 아직 안 봤으면 한 번만 팝업 — 매번 뜨면 성가시다.
  // 신원 자체가 sessionStorage 로 세션 단위 캐시라(useIdentity 참고) 그 수명에 맞췄다: 팝업을 닫으면
  // 이 탭에서는 다시 안 뜨고, 카드 안내 배너(항상 보임)로 충분히 알 수 있다.
  useEffect(() => {
    if (!scheduleReopened) return;
    try {
      if (sessionStorage.getItem(seenKey)) return;
    } catch {
      // 저장 불가(프라이빗 모드 등) — 그래도 이번 렌더에서는 한 번 보여준다.
    }
    setShowReopenPopup(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleReopened]);

  const closeReopenPopup = () => {
    setShowReopenPopup(false);
    try {
      sessionStorage.setItem(seenKey, "1");
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2600);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const changeKind = (k: RequestKind | null) => {
    setReqKind(k);
    setErr(null);
    setCards([newCard()]);
  };

  const updateCard = (id: string, patch: Partial<DraftCard>) =>
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCard = (id: string) => setCards((prev) => prev.filter((c) => c.id !== id));
  const addCard = () => setCards((prev) => [...prev, newCard()]);

  const onCardDate = (id: string, date: string) => {
    updateCard(id, { date, overlap: null, hours: null, dayLoading: !!date, mode: "add", skipRuleId: null });
    if (!date) return;
    const fd = idFD();
    fd.set("date", date);
    getDayRules(fd).then((r) => {
      if (!r.ok) {
        if (r.kind === "identity") onExpired();
        updateCard(id, { overlap: [], hours: null, dayLoading: false });
        return;
      }
      updateCard(id, { overlap: r.rules, hours: r.hours, dayLoading: false });
    });
  };

  const onCardType = (id: string, reqType: RequestType) => {
    updateCard(id, { reqType, t1: emptyHM(), t2: emptyHM(), mode: "add", skipRuleId: null });
  };

  const canSubmitCard = (c: DraftCard) => {
    if (!c.date) return false;
    if (!bounds || c.date < bounds.today || c.date > bounds.maxDate) return false;
    if (c.dayLoading) return false;
    if (c.reqType === "hours") {
      if (!c.hours) return false;
      const a = hoursArriveItem(c);
      const l = hoursLeaveItem(c);
      if (!a && !l) return false; // 둘 다 비어 있으면(아무 것도 안 바꿈) 제출 불가
      if (a && !a.resolved.ok) return false;
      if (l && !l.resolved.ok) return false;
      return true; // hours 는 항상 "추가"로만 신청한다(아래 submitTemp 참고) — replace 모드 없음
    }
    const resolved = resolvedOf(c);
    if (!resolved || !resolved.ok) return false;
    if (c.mode === "replace" && !c.skipRuleId) return false;
    return true;
  };
  const canSubmitTemp = cards.length > 0 && cards.every(canSubmitCard);

  const submitTemp = async () => {
    setErr(null);
    // hours 카드 한 장은 최대 2건(등원 변경/하원 변경)으로 쪼개진다 — canSubmitTemp 이 이미 각 필드가
    // ok 임을 보장(canSubmitCard). "이 일정 대신"(replace)은 hours 타입에는 없다(두 방향이 서로 다른
    // 정기 일정과 겹칠 수 있어 하나의 skipRuleId 로 표현할 수 없다 — 항상 "추가"로만 신청).
    const items: TempItemInput[] = cards.flatMap((c): TempItemInput[] => {
      if (c.reqType === "hours") {
        const built: TempItemInput[] = [];
        const a = hoursArriveItem(c);
        const l = hoursLeaveItem(c);
        if (a && a.resolved.ok) {
          built.push({ reqKind: "temp", date: c.date, reasonKey: c.reasonKey, title: c.title.trim(), reqType: a.reqType, raw: a.raw, mode: "add", skipRuleId: null });
        }
        if (l && l.resolved.ok) {
          built.push({ reqKind: "temp", date: c.date, reasonKey: c.reasonKey, title: c.title.trim(), reqType: l.reqType, raw: l.raw, mode: "add", skipRuleId: null });
        }
        return built;
      }
      const raw = rawInputOf(c)!; // canSubmitTemp 이 이미 보장
      return [{
        reqKind: "temp", date: c.date, reasonKey: c.reasonKey, title: c.title.trim(),
        reqType: c.reqType!, raw,
        mode: c.mode, skipRuleId: c.mode === "replace" ? c.skipRuleId : null,
      }];
    });
    const fd = idFD();
    fd.set("items", JSON.stringify(items));
    setBusy(true);
    const r = await createRequests(fd);
    setBusy(false);
    if (!r.ok) {
      if (r.kind === "identity") { onExpired(); return; }
      setErr(r.error);
      return;
    }
    setCards([newCard()]);
    setToast(`${r.rows.length}건 신청됐어요.`);
    reloadMine();
    setSubmitTick((n) => n + 1);
    setSubmittedOnce(true);
  };

  const submitRuleChange = async (item: RuleEditItemInput | RuleDeleteItemInput) => {
    setErr(null);
    const fd = idFD();
    fd.set("items", JSON.stringify([item] satisfies RequestItemInput[]));
    setBusy(true);
    const r = await createRequests(fd);
    setBusy(false);
    if (!r.ok) {
      if (r.kind === "identity") { onExpired(); return false; }
      setErr(r.error);
      return false;
    }
    setToast("신청됐어요.");
    reloadMine();
    reloadMySchedule();
    setSubmitTick((n) => n + 1);
    setSubmittedOnce(true);
    return true;
  };

  const doCancel = async (id: string) => {
    const fd = idFD();
    fd.set("id", id);
    const prev = myRequests;
    setMyRequests((cur) => (cur ?? []).filter((r) => r.id !== id));
    const r = await cancelRequest(fd);
    if (!r.ok) {
      setMyRequests(prev ?? null);
      if (r.kind === "identity") onExpired();
      else setErr(r.error);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
        <UserIcon />
        {identity.studentName} 학생으로 확인되었어요.
      </div>

      <MySchedulePanel data={mySchedule} />

      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, marginTop: 18 }}>일정 변경 신청</div>
      <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 16, lineHeight: 1.5 }}>
        신청은 관리자 승인 후 반영돼요. 매주 반복되는 등·하원 시간 자체를 바꾸고 싶다면(하루가 아니라
        계속) 이 신청이 아니라 정기 스케쥴 입력 기간에 다시 제출해주세요.
      </div>

      {scheduleReopened && scheduleSlug && (
        <Link
          href={`/f/${scheduleSlug}`}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10,
            border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 12.5, fontWeight: 700, textDecoration: "none", marginBottom: 16,
          }}
        >
          <CalendarBellIcon />
          새 스케쥴을 입력할 수 있어요 — 지금까지의 신청은 기존 스케쥴 기준으로 처리돼요.
          <span style={{ marginLeft: "auto", flex: "none" }}>
            <ArrowRightIcon />
          </span>
        </Link>
      )}

      {reqKind == null ? (
        <KindPicker onPick={changeKind} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => changeKind(null)}
            style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: "var(--sub)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: 14 }}
          >
            <BackIcon />
            다른 종류로 변경
          </button>

          <div ref={flowRef}>
            {reqKind === "temp" && (
              <TempFlow
                cards={cards} bounds={bounds} err={err} busy={busy} canSubmit={canSubmitTemp}
                onDate={onCardDate} onType={onCardType} onChange={updateCard} onAdd={addCard}
                onRemove={cards.length > 1 ? removeCard : undefined} onSubmit={submitTemp}
              />
            )}
            {reqKind === "rule_edit" && (
              <RuleEditFlow rules={mySchedule?.rules ?? null} err={err} busy={busy} onSubmit={submitRuleChange} />
            )}
            {reqKind === "rule_delete" && (
              <RuleDeleteFlow rules={mySchedule?.rules ?? null} err={err} busy={busy} onSubmit={submitRuleChange} />
            )}
          </div>
        </>
      )}

      {toast && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, textAlign: "center" }}>
          {toast}
        </div>
      )}

      {showReopenPopup && scheduleSlug && (
        <InfoPopup
          title="새 스케쥴을 입력할 수 있어요"
          lines={["관리자가 스케쥴 입력을 다시 열어줬어요.", "새 시간표를 내기 전까지, 일정 변경 신청은 지금 등록된 스케쥴을 기준으로 처리돼요."]}
          actionHref={`/f/${scheduleSlug}`}
          actionLabel="스케쥴 입력하러 가기"
          onClose={closeReopenPopup}
        />
      )}

      {submittedOnce && (
        <Link
          href={`/f/${hubSlug}`}
          className="btn btn-accent"
          style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none", marginTop: 14 }}
        >
          홈으로
        </Link>
      )}

      <div style={{ borderTop: "1px solid var(--line)", margin: "26px 0 18px" }} />

      <div ref={myRequestsRef}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>내 신청 목록</div>
        {myRequests == null ? (
          <div style={{ fontSize: 13, color: "var(--faint)", textAlign: "center", padding: "10px 4px" }}>불러오는 중…</div>
        ) : myRequests.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--faint)", textAlign: "center", padding: "10px 4px" }}>아직 신청한 내역이 없어요.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {myRequests.map((r) => (
              <MyRequestRowView key={r.id} row={r} onCancel={r.status === "pending" ? () => doCancel(r.id) : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 내 정기 스케쥴(읽기 전용, 기본 접힘) ====================
function MySchedulePanel({ data }: { data: { hours: MyHoursRow[]; rules: MyRuleRow[] } | null }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(panelRef, [open], { focus: false });
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", height: 44, padding: "0 14px", display: "flex", alignItems: "center", gap: 8,
          border: "none", background: "var(--panel2)", color: "var(--ink)", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}
      >
        <CalendarIcon />
        내 정기 스케쥴 보기
        <span style={{ marginLeft: "auto", display: "flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div ref={panelRef} style={{ padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
          {data == null ? (
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>불러오는 중…</div>
          ) : (
            <>
              <MiniTimetable hours={data.hours} rules={data.rules} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--faint)", marginBottom: 8 }}>정기 일정 목록</div>
                {data.rules.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--faint)" }}>등록된 정기 일정이 없어요.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.rules.map((r) => {
                      const style = blockStyleOf(r.reason);
                      return (
                        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: style.fg, background: style.bg, border: `1px solid ${style.bd}`, borderRadius: 999, padding: "1px 8px" }}>
                            {r.reason}
                          </span>
                          <span style={{ color: "var(--sub)", fontWeight: 700 }}>{r.daysLabel}</span>
                          <span style={{ color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>{r.timeLabel}</span>
                          {r.title && <span style={{ color: "var(--faint)" }}>{r.title}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 요일별 등·하원 + 정기 일정을 한 줄씩(월~일) 미니 바로 보여준다. 표시 범위 06:00~다음날 02:00(1200분)
 * 고정 — 그 밖 시각은 경계에 붙는다(잘림 표시일 뿐 실제 값은 목록 텍스트에 그대로 나온다). */
function MiniTimetable({ hours, rules }: { hours: MyHoursRow[]; rules: MyRuleRow[] }) {
  const DOMAIN_START = 360, DOMAIN_END = 1560, DOMAIN_LEN = DOMAIN_END - DOMAIN_START;
  const pct = (min: number) => Math.min(100, Math.max(0, ((min - DOMAIN_START) / DOMAIN_LEN) * 100));
  const hoursByDay = new Map(hours.map((h) => [h.day, h]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {DAY_LABELS.map((label, i) => {
        const dayNum = i + 1;
        const h = hoursByDay.get(dayNum);
        const dayRules = rules.filter((r) => r.days.includes(dayNum));
        return (
          <div key={dayNum} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, fontSize: 11, fontWeight: 700, color: "var(--faint)", flex: "none" }}>{label}</span>
            <div style={{ position: "relative", flex: 1, height: 16, borderRadius: 5, background: "var(--panel2)", overflow: "hidden" }}>
              {h && (
                <div
                  style={{ position: "absolute", left: `${pct(h.arrive)}%`, width: `${Math.max(1, pct(h.leave) - pct(h.arrive))}%`, top: 0, bottom: 0, background: "var(--line)", opacity: 0.6 }}
                />
              )}
              {dayRules.map((r) => {
                const style = blockStyleOf(r.reason);
                const left = pct(r.start);
                const width = Math.max(1.5, pct(r.end) - left);
                return (
                  <div
                    key={r.id}
                    title={`${r.reason} ${r.timeLabel}`}
                    style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 1, bottom: 1, borderRadius: 3, background: style.bg, border: `1px solid ${style.bd}` }}
                  />
                );
              })}
            </div>
            <span style={{ width: 92, flex: "none", fontSize: 10.5, color: "var(--faint)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {h ? `${h.arriveLabel}–${h.leaveLabel}` : "휴무"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 1단계: 무엇을 신청할까요? ====================
function KindPicker({ onPick }: { onPick: (k: RequestKind) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="label">무엇을 신청할까요?</span>
      {REQUEST_KINDS.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={() => onPick(k.key)}
          style={{
            display: "flex", flexDirection: "column", gap: 3, textAlign: "left", padding: "12px 14px", borderRadius: 12,
            border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{k.label}</span>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>{k.desc}</span>
        </button>
      ))}
    </div>
  );
}

// ==================== 2-A. 임시 변경 ====================
function TempFlow({
  cards, bounds, err, busy, canSubmit, onDate, onType, onChange, onAdd, onRemove, onSubmit,
}: {
  cards: DraftCard[];
  bounds: { today: string; maxDate: string } | null;
  err: string | null;
  busy: boolean;
  canSubmit: boolean;
  onDate: (id: string, date: string) => void;
  onType: (id: string, reqType: RequestType) => void;
  onChange: (id: string, patch: Partial<DraftCard>) => void;
  onAdd: () => void;
  onRemove?: (id: string) => void;
  onSubmit: () => void;
}) {
  // 새 카드가 추가되면(신청 추가 클릭) 그 카드로 스크롤-포커스한다 — 포커스 대상은 카드 자체가
  // 정하므로 여기선 화면에 보이게만 만든다.
  const lastCardRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(lastCardRef, [cards.length], { focus: false });

  if (!bounds) return <div style={{ fontSize: 13, color: "var(--faint)", padding: "20px 4px", textAlign: "center" }}>불러오는 중…</div>;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
        {cards.map((c, i) => (
          <div key={c.id} ref={i === cards.length - 1 ? lastCardRef : undefined}>
            <RequestCard
              index={i}
              card={c}
              bounds={bounds}
              onDate={(d) => onDate(c.id, d)}
              onType={(t) => onType(c.id, t)}
              onChange={(patch) => onChange(c.id, patch)}
              onRemove={onRemove ? () => onRemove(c.id) : undefined}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        style={{
          width: "100%", height: 46, borderRadius: 12, border: "1px dashed var(--accent)", background: "var(--accent-soft)",
          color: "var(--accent)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        <PlusIcon />
        신청 추가
      </button>

      {err && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, marginTop: 14 }}>{err}</div>}

      <button
        type="button"
        className="btn btn-accent"
        disabled={!canSubmit || busy}
        onClick={onSubmit}
        style={{ width: "100%", height: 50, fontSize: 15, fontWeight: 700, marginTop: 16 }}
      >
        {busy ? "제출 중…" : "신청하기"}
      </button>
    </>
  );
}

// ==================== 2-B/2-C 공용: 대상 정기 일정 고르기 ====================
function RulePicker({ rules, selectedId, onSelect }: { rules: MyRuleRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (rules.length === 0) {
    return <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "14px 4px", textAlign: "center" }}>등록된 정기 일정이 없어요.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rules.map((r) => {
        const active = r.id === selectedId;
        const style = blockStyleOf(r.reason);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", textAlign: "left", padding: "10px 12px", borderRadius: 10,
              border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, background: active ? "var(--accent-soft)" : "var(--card)", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: style.fg, background: style.bg, border: `1px solid ${style.bd}`, borderRadius: 999, padding: "1px 8px" }}>
              {r.reason}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)" }}>{r.daysLabel}</span>
            <span style={{ fontSize: 12.5, color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>{r.timeLabel}</span>
            {r.title && <span style={{ fontSize: 12, color: "var(--faint)" }}>{r.title}</span>}
          </button>
        );
      })}
    </div>
  );
}

function DaysToggle({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
      {DAY_LABELS.map((label, i) => {
        const dayNum = i + 1;
        const active = value.includes(dayNum);
        return (
          <button
            key={dayNum}
            type="button"
            onClick={() => onChange(active ? value.filter((d) => d !== dayNum) : [...value, dayNum])}
            style={{
              height: 38, borderRadius: 9, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
              background: active ? "var(--accent)" : "var(--card)", color: active ? "#fff" : "var(--sub)",
              fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ==================== 2-B. 정기 일정 수정 ====================
function RuleEditFlow({
  rules, err, busy, onSubmit,
}: {
  rules: MyRuleRow[] | null;
  err: string | null;
  busy: boolean;
  onSubmit: (item: RuleEditItemInput) => Promise<boolean>;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [reasonKey, setReasonKey] = useState(SCHEDULE_REASONS[0].key);
  const [title, setTitle] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [t1, setT1] = useState<HM>(emptyHM());
  const [t2, setT2] = useState<HM>(emptyHM());

  if (rules == null) return <div style={{ fontSize: 13, color: "var(--faint)", padding: "20px 4px", textAlign: "center" }}>불러오는 중…</div>;

  const target = rules.find((r) => r.id === targetId) ?? null;

  const selectTarget = (id: string) => {
    const r = rules.find((x) => x.id === id);
    if (!r) return;
    setTargetId(id);
    setReasonKey(SCHEDULE_REASONS.find((s) => s.label === r.reason)?.key ?? SCHEDULE_REASONS[0].key);
    setTitle(r.title);
    setDays(r.days);
    setT1({ h: pad2(Math.floor((r.start % 1440) / 60)), m: pad2(r.start % 60) });
    const endMod = r.end % 1440;
    setT2({ h: pad2(Math.floor(endMod / 60)), m: pad2(endMod % 60) });
  };

  const start = parseHM(t1);
  const end = parseHM(t2);
  const canSubmit = !!target && days.length > 0 && start != null && end != null;

  const submit = async () => {
    if (!target || start == null || end == null || days.length === 0) return;
    const ok = await onSubmit({ reqKind: "rule_edit", targetRuleId: target.id, reasonKey, title: title.trim(), days, start, end });
    if (ok) {
      setTargetId(null); setReasonKey(SCHEDULE_REASONS[0].key); setTitle(""); setDays([]); setT1(emptyHM()); setT2(emptyHM());
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <span className="label">수정할 정기 일정을 선택하세요</span>
        <RulePicker rules={rules} selectedId={targetId} onSelect={selectTarget} />
      </div>

      {target && (
        <>
          <div style={{ fontSize: 12, color: "var(--faint)" }}>
            현재: {target.daysLabel} · {target.timeLabel} · {target.reason}
          </div>

          <label>
            <span className="label">사유</span>
            <select className="input" value={reasonKey} onChange={(e) => setReasonKey(e.target.value)} style={{ height: 42 }}>
              {SCHEDULE_REASONS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>

          <div>
            <span className="label">요일</span>
            <DaysToggle value={days} onChange={setDays} />
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px", minWidth: 130 }}>
              <span className="label">시작</span>
              <ClockInput value={t1} onChange={setT1} />
            </div>
            <div style={{ flex: "1 1 140px", minWidth: 130 }}>
              <span className="label">종료</span>
              <ClockInput value={t2} onChange={setT2} />
            </div>
          </div>
          <OvernightNote start={t1} end={t2} />

          <label>
            <span className="label">제목(선택)</span>
            <input className="input" value={title} placeholder="예: 수학학원" onChange={(e) => setTitle(e.target.value)} onBlur={(e) => setTitle(e.currentTarget.value.trim().slice(0, 60))} style={{ height: 42 }} />
          </label>

          {err && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{err}</div>}

          <button
            type="button"
            className="btn btn-accent"
            disabled={!canSubmit || busy}
            onClick={submit}
            style={{ width: "100%", height: 50, fontSize: 15, fontWeight: 700 }}
          >
            {busy ? "제출 중…" : "수정 신청하기"}
          </button>
        </>
      )}
    </div>
  );
}

// ==================== 2-C. 정기 일정 삭제 ====================
function RuleDeleteFlow({
  rules, err, busy, onSubmit,
}: {
  rules: MyRuleRow[] | null;
  err: string | null;
  busy: boolean;
  onSubmit: (item: RuleDeleteItemInput) => Promise<boolean>;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  if (rules == null) return <div style={{ fontSize: 13, color: "var(--faint)", padding: "20px 4px", textAlign: "center" }}>불러오는 중…</div>;
  const target = rules.find((r) => r.id === targetId) ?? null;

  const submit = async () => {
    if (!target) return;
    const ok = await onSubmit({ reqKind: "rule_delete", targetRuleId: target.id });
    if (ok) setTargetId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <span className="label">삭제할 정기 일정을 선택하세요</span>
        <RulePicker rules={rules} selectedId={targetId} onSelect={setTargetId} />
      </div>

      {target && (
        <>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--panel2)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}>
              <WarnIcon />
              이 정기 일정을 완전히 삭제해요
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{target.daysLabel} · {target.timeLabel} · {target.reason}{target.title ? ` · ${target.title}` : ""}</div>
          </div>

          {err && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{err}</div>}

          <button
            type="button"
            disabled={busy}
            onClick={submit}
            style={{
              width: "100%", height: 50, fontSize: 15, fontWeight: 700, borderRadius: 12, cursor: busy ? "default" : "pointer",
              border: "1px solid var(--danger)", background: "var(--danger)", color: "#fff", opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "제출 중…" : "삭제 신청하기"}
          </button>
        </>
      )}
    </div>
  );
}

// ==================== 내 신청 목록 ====================
function MyRequestRowView({ row, onCancel }: { row: MyRequestRow; onCancel?: () => void }) {
  const chip = statusChip[row.status];
  const style = blockStyleOf(row.reason);
  const kindLabel = row.reqKind === "temp" ? requestTypeOf(row.reqType).label : (row.reqKind === "rule_edit" ? "정기 수정" : "정기 삭제");
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>{row.dateLabel ?? (row.daysLabel || "정기 일정")}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 9px" }}>
          {kindLabel}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: style.fg, background: style.bg, border: `1px solid ${style.bd}`, borderRadius: 999, padding: "1px 9px" }}>
          {row.reason}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: chip.fg, background: chip.bg, borderRadius: 999, padding: "1px 9px", marginLeft: "auto" }}>
          {chip.label}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>{row.timeLabel}</div>
      {row.title && <div style={{ fontSize: 12.5, color: "var(--dim)" }}>{row.title}</div>}
      {row.status === "rejected" && row.note && (
        <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>반려 사유: {row.note}</div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{ alignSelf: "flex-start", marginTop: 2, height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--sub)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          신청 취소
        </button>
      )}
    </div>
  );
}

function RequestCard({
  index, card, bounds, onDate, onType, onChange, onRemove,
}: {
  index: number;
  card: DraftCard;
  bounds: { today: string; maxDate: string };
  onDate: (date: string) => void;
  onType: (reqType: RequestType) => void;
  onChange: (patch: Partial<DraftCard>) => void;
  onRemove?: () => void;
}) {
  const dateInvalid = !!card.date && (card.date < bounds.today || card.date > bounds.maxDate);
  const needsHours = card.reqType === "absent" || card.reqType === "late" || card.reqType === "early" || card.reqType === "hours";
  const missingHours = needsHours && !!card.date && !card.dayLoading && card.hours === null;
  const resolved = resolvedOf(card);
  const overlapping = overlapsOf(card);
  const hoursArrive = card.reqType === "hours" ? hoursArriveItem(card) : null;
  const hoursLeave = card.reqType === "hours" ? hoursLeaveItem(card) : null;

  // 5유형 중 하나를 고르면 시간 입력 영역으로 스크롤-포커스한다("absent" 는 시간 입력이 없어서 no-op).
  const timeAreaRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(timeAreaRef, [card.reqType]);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "16px 14px 14px", position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--faint)" }}>신청 {index + 1}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="신청 삭제"
            style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--dim)", cursor: "pointer" }}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      <div>
        <span className="label">유형</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 6 }}>
          {CARD_TILE_TYPES.map((t) => {
            const active = card.reqType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onType(t.key)}
                style={{
                  height: 40, borderRadius: 10, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  background: active ? "var(--accent-soft)" : "var(--card)",
                  color: active ? "var(--accent)" : "var(--sub)",
                  fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {card.reqType && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>{requestTypeOf(card.reqType).desc}</div>}
      </div>

      {card.reqType && (
        <>
          <label>
            <span className="label">날짜</span>
            <input
              className="input"
              type="date"
              value={card.date}
              min={bounds.today}
              max={bounds.maxDate}
              onChange={(e) => onDate(e.target.value)}
              style={{ height: 42 }}
            />
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>오늘부터 14일 이내({mdLabel(bounds.today)}~{mdLabel(bounds.maxDate)})만 가능해요.</div>
            {dateInvalid && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 4 }}>신청 가능한 날짜가 아니에요.</div>}
          </label>

          <label>
            <span className="label">사유</span>
            <select className="input" value={card.reasonKey} onChange={(e) => onChange({ reasonKey: e.target.value })} style={{ height: 42 }}>
              {SCHEDULE_REASONS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>

          {missingHours && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--panel2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)", display: "flex", alignItems: "center", gap: 6 }}>
                <WarnIcon />
                이 날은 정기 등·하원 시각이 없어요
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>휴무이거나 스케쥴을 아직 제출하지 않았어요. 이 유형은 정기 등·하원 시각이 있어야 계산할 수 있어요 — &quot;직접 입력&quot;으로 신청해주세요.</div>
              <button
                type="button"
                onClick={() => onType("custom")}
                style={{ alignSelf: "flex-start", height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                직접 입력으로 전환
              </button>
            </div>
          )}

          {card.dayLoading && <div style={{ fontSize: 12, color: "var(--faint)" }}>정기 일정 확인 중…</div>}

          {!card.dayLoading && card.reqType === "hours" && card.hours && (
            <div ref={timeAreaRef}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                  <span className="label">등원 시각(원래 {fmtMin(card.hours.arrive)})</span>
                  <ClockInput value={card.t1} onChange={(v) => onChange({ t1: v })} />
                  {hoursArrive && !hoursArrive.resolved.ok && (
                    <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{hoursArrive.resolved.error}</div>
                  )}
                  {hoursArrive && hoursArrive.resolved.ok && (
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 6 }}>
                      → {fmtMin(card.hours.arrive)}에서 {fmtMin(parseHM(card.t1)!)}로 바뀌어요.
                    </div>
                  )}
                </div>
                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                  <span className="label">하원 시각(원래 {fmtLeave(card.hours.leave)})</span>
                  <ClockInput value={card.t2} onChange={(v) => onChange({ t2: v })} />
                  {hoursLeave && !hoursLeave.resolved.ok && (
                    <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{hoursLeave.resolved.error}</div>
                  )}
                  {hoursLeave && hoursLeave.resolved.ok && (
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 6 }}>
                      → {fmtLeave(card.hours.leave)}에서 {fmtMin(parseHM(card.t2)!)}로 바뀌어요.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>등원·하원 중 바뀌는 시각만 입력하세요. 한쪽만 바꿀 수도 있어요.</div>
              {!hoursArrive && !hoursLeave && (
                <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>등원·하원 중 적어도 하나는 입력해주세요.</div>
              )}
            </div>
          )}

          {!card.dayLoading && card.reqType !== "absent" && card.reqType !== "hours" && (
            <div ref={timeAreaRef}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {card.reqType === "late" && (
                  <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                    <span className="label">등원 시각</span>
                    <ClockInput value={card.t1} onChange={(v) => onChange({ t1: v })} />
                  </div>
                )}
                {card.reqType === "early" && (
                  <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                    <span className="label">하원 시각</span>
                    <ClockInput value={card.t1} onChange={(v) => onChange({ t1: v })} />
                  </div>
                )}
                {card.reqType === "out" && (
                  <>
                    <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                      <span className="label">나가는 시각</span>
                      <ClockInput value={card.t1} onChange={(v) => onChange({ t1: v })} />
                    </div>
                    <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                      <span className="label">돌아오는 시각</span>
                      <ClockInput value={card.t2} onChange={(v) => onChange({ t2: v })} />
                    </div>
                  </>
                )}
                {card.reqType === "custom" && (
                  <>
                    <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                      <span className="label">시작</span>
                      <ClockInput value={card.t1} onChange={(v) => onChange({ t1: v })} />
                    </div>
                    <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                      <span className="label">종료</span>
                      <ClockInput value={card.t2} onChange={(v) => onChange({ t2: v })} />
                    </div>
                  </>
                )}
              </div>
              {(card.reqType === "out" || card.reqType === "custom") && <OvernightNote start={card.t1} end={card.t2} />}
              {resolved && !resolved.ok && (
                <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>{resolved.error}</div>
              )}
              {resolved && resolved.ok && (
                <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 8 }}>
                  → {fmtMin(resolved.start)}–{fmtLeave(resolved.end)}로 신청돼요.
                </div>
              )}
            </div>
          )}

          {!card.dayLoading && card.reqType === "absent" && resolved && resolved.ok && (
            <div style={{ fontSize: 12, color: "var(--sub)" }}>→ {fmtMin(resolved.start)}–{fmtLeave(resolved.end)} 전체를 결석으로 신청돼요.</div>
          )}

          <label>
            <span className="label">메모(선택)</span>
            <input
              className="input"
              value={card.title}
              placeholder="예: 병원 진료로 일찍 나가요"
              onChange={(e) => onChange({ title: e.target.value })}
              onBlur={(e) => onChange({ title: e.currentTarget.value.trim().slice(0, 60) })}
              style={{ height: 42 }}
            />
          </label>

          {!card.dayLoading && overlapping.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--panel2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)", display: "flex", alignItems: "center", gap: 6 }}>
                <WarnIcon />
                그 시간에 겹치는 정기 일정이 있어요
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {overlapping.map((r) => (
                  <div key={r.id} style={{ fontSize: 12.5, color: "var(--sub)" }}>
                    {r.title ? `${r.title}(${r.reason})` : r.reason} · {fmtMin(r.start)}–{fmtLeave(r.end)}
                  </div>
                ))}
              </div>
              {/* hours 는 등원 변경·하원 변경이 서로 다른 정기 일정과 겹칠 수 있어 skipRuleId 하나로
                  "대체"를 표현할 수 없다 — 항상 "추가"로만 신청하고, 여기서는 겹침 정보만 보여준다. */}
              {card.reqType !== "hours" && (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <ModeButton label="추가로" active={card.mode === "add"} onClick={() => onChange({ mode: "add", skipRuleId: null })} />
                    <ModeButton
                      label="이 일정 대신"
                      active={card.mode === "replace"}
                      onClick={() => onChange({ mode: "replace", skipRuleId: overlapping.length === 1 ? overlapping[0].id : card.skipRuleId })}
                    />
                  </div>
                  {card.mode === "replace" && overlapping.length > 1 && (
                    <select
                      className="input"
                      value={card.skipRuleId ?? ""}
                      onChange={(e) => onChange({ skipRuleId: e.target.value || null })}
                      style={{ height: 38 }}
                    >
                      <option value="">대체할 일정을 선택하세요</option>
                      {overlapping.map((r) => (
                        <option key={r.id} value={r.id}>{r.title ? `${r.title}(${r.reason})` : r.reason} · {fmtMin(r.start)}–{fmtLeave(r.end)}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, height: 34, borderRadius: 8, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--card)", color: active ? "var(--accent)" : "var(--sub)",
        fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function OvernightNote({ start, end }: { start: HM; end: HM }) {
  const s = parseHM(start);
  const eRaw = parseHM(end);
  const overnight = s != null && eRaw != null && eRaw <= s;
  if (!overnight || eRaw == null) return null;
  return (
    <div style={{ fontSize: 12, color: "var(--warn)", fontWeight: 700, marginTop: 8 }}>
      자정을 넘겨요 — {fmtLeave(eRaw + 1440)} 로 저장돼요.
    </div>
  );
}

/** 시/분 두 칸. onChange=필터+slice(-2)만, blur=e.currentTarget.value 읽어 정규화, focus=select(),
 * 시 2자리 채우면 분 칸으로 자동 이동(커밋 후 useEffect). sch9m2vt.tsx 의 ClockInput 과 같은 패턴. */
function ClockInput({ value, onChange }: { value: HM; onChange: (v: HM) => void }) {
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const [jump, setJump] = useState(false);

  useEffect(() => {
    if (jump) {
      mRef.current?.focus();
      setJump(false);
    }
  }, [jump]);

  const boxStyle: React.CSSProperties = {
    width: 56, height: 46, borderRadius: 10, border: "1px solid var(--line)", background: "#fff",
    textAlign: "center", fontSize: 19, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums", outline: "none",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        ref={hRef}
        value={value.h}
        inputMode="numeric"
        maxLength={2}
        placeholder="00"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(-2);
          onChange({ ...value, h: v });
          if (v.length === 2) setJump(true);
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") return;
          const h = clampInt(parseInt(raw, 10) || 0, 0, 23);
          onChange({ ...value, h: pad2(h) });
        }}
        style={boxStyle}
      />
      <span style={{ fontSize: 17, color: "var(--sub)", fontWeight: 700 }}>:</span>
      <input
        ref={mRef}
        value={value.m}
        inputMode="numeric"
        maxLength={2}
        placeholder="00"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(-2);
          onChange({ ...value, m: v });
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") return;
          const m = clampInt(parseInt(raw, 10) || 0, 0, 59);
          onChange({ ...value, m: pad2(m) });
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && value.m === "") {
            e.preventDefault();
            hRef.current?.focus();
          }
        }}
        style={boxStyle}
      />
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
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M8 2.5v3M16 2.5v3" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5.5 3.5 10.5 8 5.5 12.5" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="10.5 3.5 5.5 8 10.5 12.5" />
    </svg>
  );
}
function CalendarBellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M8 2.5v3M16 2.5v3" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
