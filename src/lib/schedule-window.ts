// 학생 스케쥴 입력 기간 판정 — 순수 함수(DB·세션 의존 없음). 실제 조회는 schedule-window-server.ts.
//
// 규칙(우선순위 순 — 하나라도 해당하면 그 즉시 열림):
//   1) 한 번도 제출한 적 없는 학생 → 언제든 첫 제출 가능(마감 없음).
//   2) 첫 제출 시각으로부터 24시간 이내(grace) → 자유롭게 수정 가능.
//   3) grace 가 지났으면, 관리자가 지점 전체에 연 입력 기간(schedule_window) 안에 있으면 열림.
//   4) 3 이 아니어도, 이 학생만을 위한 개별 개방(schedule_grant) 안에 있으면 열림.
//   5) 그 외엔 잠김. 가장 이른 미래의 window/grant 시작 시각을 "다음 입력 기간"으로 안내.
//
// 시각 비교는 전부 Date 인스턴스(=절대 시각)로 한다 — timestamptz 는 타임존과 무관하게 비교 가능하므로
// 판정 자체(evaluateEdit)에는 KST 개념이 필요 없다. "표시용" 문자열(오늘 21:30까지 등)만 KST 기준으로
// 포맷해야 하고, formatEditState 가 담당한다(호출부는 무인자 new Date() 로 날짜 문자열을 만들지 말고
// 반드시 명시적 now 를 넘길 것).
import { todayKey, timeLabel, dateTimeLabel, dateOnlyLabel } from "./date";

export type EditReason = "first" | "grace" | "window" | "grant";

/** 최종 판정 결과 — until/nextOpen 은 서버(formatEditState)가 KST 로 포맷한 문자열. */
export type EditState =
  | { open: true; reason: EditReason; until?: string }
  | { open: false; reason: "locked"; nextOpen?: string };

/** evaluateEdit() 의 원시(Date) 결과 — formatEditState() 가 이걸 KST 문자열 EditState 로 바꾼다. */
export type EditDecision =
  | { open: true; reason: EditReason; untilAt?: Date }
  | { open: false; reason: "locked"; nextOpenAt?: Date };

export type TimeRange = { opensAt: Date; closesAt: Date };

export type EditFacts = {
  now: Date;
  /** 이 학생의 첫 제출 시각. 한 번도 제출한 적 없으면 null. */
  firstSubmittedAt: Date | null;
  /** 지점 전체 입력 기간(schedule_window) 전체 — 열려있지 않은 것도 포함해서 넘긴다(다음 기간 안내용). */
  windows: TimeRange[];
  /** 이 학생 개별 개방(schedule_grant) 전체. */
  grants: TimeRange[];
};

const GRACE_MS = 24 * 60 * 60 * 1000;

/** [opensAt, closesAt) 구간에 now 가 포함되는지 — closesAt 은 배타적 경계(schedule.ts statusAt 과 같은 관례). */
const contains = (r: TimeRange, now: Date) => now >= r.opensAt && now < r.closesAt;

export function evaluateEdit(facts: EditFacts): EditDecision {
  const { now, firstSubmittedAt, windows, grants } = facts;

  // 1) 한 번도 제출한 적 없음 — 마감 없이 항상 열림.
  if (firstSubmittedAt == null) return { open: true, reason: "first" };

  // 2) 첫 제출 후 24시간 유예.
  const graceUntil = new Date(firstSubmittedAt.getTime() + GRACE_MS);
  if (now < graceUntil) return { open: true, reason: "grace", untilAt: graceUntil };

  // 3) 지점 전체 입력 기간.
  const openWindow = windows.find((w) => contains(w, now));
  if (openWindow) return { open: true, reason: "window", untilAt: openWindow.closesAt };

  // 4) 개별 개방.
  const openGrant = grants.find((g) => contains(g, now));
  if (openGrant) return { open: true, reason: "grant", untilAt: openGrant.closesAt };

  // 5) 잠김 — 가장 이른 미래 시작 시각을 안내.
  const future = [...windows, ...grants]
    .map((r) => r.opensAt)
    .filter((d) => d > now)
    .sort((a, b) => a.getTime() - b.getTime());
  return { open: false, reason: "locked", nextOpenAt: future[0] };
}

/** "오늘 HH:MM"(같은 KST 날짜) 또는 "M월 D일 HH:MM"(다른 날) — 마감(until) 표시용. */
function untilLabelOf(at: Date, now: Date): string {
  const iso = at.toISOString();
  return todayKey(at) === todayKey(now) ? `오늘 ${timeLabel(iso)}` : dateTimeLabel(iso);
}
/** "오늘 HH:MM" 또는 "M월 D일" — 다음 입력 기간(nextOpen) 표시용. 오늘 안이면 시각까지, 아니면 날짜만. */
function nextOpenLabelOf(at: Date, now: Date): string {
  const iso = at.toISOString();
  return todayKey(at) === todayKey(now) ? `오늘 ${timeLabel(iso)}` : dateOnlyLabel(iso);
}

/** evaluateEdit() 의 Date 결과를 화면에 내려줄 KST 문자열 EditState 로 바꾼다. now 는 evaluateEdit 에
 *  넘긴 것과 같은 값을 그대로 써야 "오늘"판정이 어긋나지 않는다. */
export function formatEditState(decision: EditDecision, now: Date): EditState {
  if (decision.open) {
    return {
      open: true,
      reason: decision.reason,
      until: decision.untilAt ? untilLabelOf(decision.untilAt, now) : undefined,
    };
  }
  return {
    open: false,
    reason: "locked",
    nextOpen: decision.nextOpenAt ? nextOpenLabelOf(decision.nextOpenAt, now) : undefined,
  };
}
