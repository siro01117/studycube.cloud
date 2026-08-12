// 학생 스케쥴러 파생 판정 — 등하원 시각 + 일정 블록 + 운영 시간표(교시)만으로 "지금 무엇을 하고
// 있어야 하는가"를 계산한다. 자습은 저장하지 않는다: 다른 일정이 없고 등원~하원 사이면서 교시 구간에
// 걸쳐 있으면 자습으로 간주(파생 상태).
// 순수 함수 — DOM·DB 의존 없음. 순찰 화면 등에서 재사용할 수 있도록 여기 둔다(이번 작업 범위에선 연동하지 않음).

export type DaySlot = { start: number; end: number; reason: string; kind: string };
export type Period = { start: number; end: number };

/** 그날 학생의 실제 출결(입실/퇴실) 요약 — statusAt 이 스케쥴만 보고 오판(예: 스케쥴보다 일찍 입실했는데
 * 계속 "등원전"으로 표시)하지 않도록 넘겨준다. 호출부가 KST 분(minute-of-day) 좌표계로 변환해서 넘긴다.
 * - firstInMin: 오늘 첫 "입실" 이벤트 시각(분). 없으면 null/undefined.
 * - lastOutMin: 오늘 "마지막 이벤트"가 "퇴실"일 때만 그 시각(분) — 그 뒤 다시 입실했으면 null 이어야 한다
 *   (즉 "지금 원 밖에 있다"가 확정된 경우만 채운다. 호출부가 이 불변식을 지켜서 넘겨야 한다).
 */
export type ActualAttendance = { firstInMin?: number | null; lastOutMin?: number | null };

/**
 * 특정 요일·시각에 학생이 무엇을 하고 있어야 하는지 판정한다.
 * 우선순위: 일정 블록(scheduled) > 자습(study) > 쉬는시간(break) > 등원전/하원(away).
 * - slots 중 minute 을 포함하는 블록이 있으면 scheduled + 그 사유 라벨(실제 출결과 무관하게 최우선).
 * - actual.lastOutMin 이 있고 minute 이 그 이후면(그 뒤 재입실 없음이 이미 lastOutMin 산정 규칙으로
 *   보장됨) 스케쥴 하원 시각과 무관하게 즉시 away + "하원"(스케쥴보다 일찍 나갔어도 나간 건 나간 것).
 * - 유효 등원 시각(effectiveArrive) = 스케쥴 등원(hours.arrive_min)과 실제 첫 입실(actual.firstInMin)
 *   중 이른 쪽. 스케쥴이 아예 없어도 firstInMin 만 있으면 그 시각부터 유효 등원으로 본다.
 * - effectiveArrive 부터(스케쥴 하원이 있다면 그 전까지, 없으면 무제한) 구간이면:
 *   - periods 가 비어 있으면(운영 시간표 미설정) study + "자습"(회귀 방지 폴백).
 *   - periods 중 minute 을 포함하는 교시가 있으면 study + "자습".
 *   - 아니면(교시 사이 쉬는시간·1교시 전·마지막 교시 후) break + "쉬는시간".
 * - 그 외 state 는 "away" 로 유지(호출부 호환)하되 label 은 시각에 따라 세분화:
 *   스케쥴 하원 정보가 있고 minute >= leave_min → "하원". 그 외엔 "등원전".
 * 자정 넘김(1440 초과) 좌표계를 그대로 쓴다(호출부가 minute·actual 모두 그 좌표계로 넘겨야 함).
 */
export function statusAt(
  minute: number,
  hours: { arrive_min: number; leave_min: number } | null,
  slots: DaySlot[],
  periods: Period[] = [],
  actual: ActualAttendance | null = null,
): { state: "scheduled" | "study" | "break" | "away"; label: string; slot?: DaySlot } {
  const hit = slots.find((s) => minute >= s.start && minute < s.end);
  if (hit) return { state: "scheduled", label: hit.reason, slot: hit };

  const firstIn = actual?.firstInMin ?? null;
  const lastOut = actual?.lastOutMin ?? null;

  // 실제 마지막 퇴실이 확정돼 있고(그 뒤 재입실 없음) 지금이 그 이후면 스케쥴 하원 시각보다 일러도 하원.
  if (lastOut != null && minute >= lastOut) {
    return { state: "away", label: "하원" };
  }

  const effectiveArrive = hours
    ? (firstIn != null ? Math.min(hours.arrive_min, firstIn) : hours.arrive_min)
    : firstIn;
  const leave = hours ? hours.leave_min : null;

  if (effectiveArrive != null && minute >= effectiveArrive && (leave == null || minute < leave)) {
    if (periods.length === 0) return { state: "study", label: "자습" };
    const inPeriod = periods.some((p) => minute >= p.start && minute < p.end);
    return inPeriod ? { state: "study", label: "자습" } : { state: "break", label: "쉬는시간" };
  }
  if (hours && minute >= hours.leave_min) {
    return { state: "away", label: "하원" };
  }
  return { state: "away", label: "등원전" };
}

// ---------------- 순찰 고스트(예상 상태) 표시 색 ----------------
// 데스크탑(m/seat/FloorEditor.tsx)·모바일(patrol/MobilePatrol.tsx) 공용 계산.
// 색 자체는 src/lib/semantic-color.ts 의 SEMANTIC 이 단일 출처 — 여기서는 "사유(reason) 문구 → 의미 키"
// 매핑만 갖는다. kind 기준으로 묶으면 "외부 학원"과 "원내 수업"이 둘 다 kind=academy 라 같은 색으로 나와
// 구분이 안 됐던 문제라, reason 텍스트를 그대로 키로 쓴다. statusAt() 이 돌려주는 label 이 그대로
// 이 맵의 키다(scheduled 는 slot.reason, study 는 "자습") — 호출부는 ghost.label 을 그대로 넘기면 된다.
import { type SemanticKey, solid, tint, ghostTint, ink, line } from "./semantic-color";

export const REASON_SEMANTIC: Record<string, SemanticKey> = {
  '자습': 'present',       // 가장 흔한 사유 — 순찰 '입석'과 같은 hue
  '외부 학원': 'academy',   // 순찰 '학원'과 같은 hue
  '원내 수업': 'inClass',   // academy 와 다른 hue로 분리(과거엔 kind=academy 로 묶여 구분 안 됐음)
  '주간 상담': 'counsel',   // 순찰 '상담'과 같은 hue
  '외부 일정': 'away',      // 순찰 '자리비움'과 같은 hue
  '기타': 'none',
  '등원전': 'none',
  '하원': 'none',
  '쉬는시간': 'none',
};
const GHOST_FALLBACK_REASON = '기타';

/** reason 문구(statusAt 이 돌려준 label)의 순색(solid) — 마크되지 않은 고스트의 라벨 글자색 등에 쓴다.
 * 모르는 문구는 "기타"(none, 무채색)로 대체. */
export function reasonColor(reason: string): string {
  return solid(REASON_SEMANTIC[reason] ?? REASON_SEMANTIC[GHOST_FALLBACK_REASON]);
}

export type GhostStyle = { bg: string; strip: string | undefined; dim: number };

/**
 * 고스트(마크되지 않은 좌석의 예상 상태) 배경·좌측 스트립 색·전체 흐림 정도를 계산한다.
 * 실제로 마크된 좌석(순찰 마크 = 진한 tint + 강한 테두리, src/lib/patrol.ts 의 markColors)과
 * 나란히 놓아도 헷갈리지 않도록 배경은 "옅은 물빛"만 섞는다 — 테두리는 여기서 건드리지 않는다
 * (선택·체크 표시는 호출부 몫).
 * - scheduled(외부 학원 등): 의미색을 ghostTint(기본 12%)로 섞은 옅은 배경 + 그 색 스트립(line).
 * - study(자습): 가장 흔한 사유라 더 옅게(4%) 섞고, 스트립도 중립 라인 색으로 은은하게
 *   (순찰 '입석' 마크는 markColors 로 지금처럼 분명히 남는다 — 고스트만 더 옅어짐).
 * - break(쉬는시간): 등하원 안이지만 교시 밖 — 원 안에 있는 상태라 away 처럼 흐리게 하지 않는다(dim 1).
 *   무채색(none) 계열을 아주 옅게(6%) 섞은 배경 + 무채색 스트립으로 등원전/하원과 구분한다.
 * - away(등원전/하원): 채도 없이 좌석 전체를 흐리게(opacity) + 중립 배경, 스트립 없음.
 * reason 은 statusAt() 이 돌려준 label 을 그대로 넘기면 된다(모르는 문구가 오면 "기타" 색으로 대체).
 * 순수 함수 — DOM 의존 없음(CSS 색 문자열만 반환, color-mix 는 브라우저가 렌더링 시점에 계산).
 */
export function ghostStyleOf(state: 'scheduled' | 'study' | 'break' | 'away' | 'none', reason?: string): GhostStyle {
  if (state === 'none') {
    // 스케쥴 데이터 자체가 없는 학생 — "부재"가 아니라 "정보 없음"이라 away(0.55)보다는 덜 흐리게(0.75).
    return { bg: ghostTint('none'), strip: line('none'), dim: 0.75 };
  }
  if (state === 'away') {
    return { bg: 'var(--panel2)', strip: undefined, dim: 0.55 };
  }
  if (state === 'break') {
    return { bg: ghostTint('none', 6), strip: line('none'), dim: 1 };
  }
  if (state === 'study') {
    return { bg: ghostTint('present', 4), strip: 'var(--line)', dim: 1 };
  }
  const key = REASON_SEMANTIC[reason ?? ''] ?? REASON_SEMANTIC[GHOST_FALLBACK_REASON];
  return { bg: ghostTint(key), strip: line(key), dim: 1 };
}

/**
 * 순찰 "미점검" 집계(경고·점검 N/M 분모)에서 제외할 학생인지 — 고스트 상태가 없음(스케쥴 정보 자체가
 * scheduleMap 에 없어 ghostOf 에 엔트리가 안 잡힌 경우 = 미설정), away(등원전/하원), 또는
 * break(쉬는시간)면 제외한다. 쉬는시간은 교시 사이 자리를 비울 수 있는 시간이라 미점검 경고 대상이
 * 아니다(좌석 표시는 그대로 "쉬는시간" 라벨 유지 — 이 함수는 집계에서만 뺀다).
 * study(자습)·scheduled(일정)만 정상 집계 대상(실제로 확인이 필요한 학생)이다. 제외돼도 탭해서 찍으면
 * 그 기록은 그대로 남는다(이 함수는 집계용일 뿐 입력 자체를 막지 않는다).
 * 모바일(MobilePatrol.tsx)·데스크탑(FloorEditor.tsx) 공용.
 */
export function isPatrolExempt(state: "scheduled" | "study" | "break" | "away" | "none" | undefined): boolean {
  return state === undefined || state === "none" || state === "away" || state === "break";
}

// ---------------- 퇴실 처리 확인창 분기 ----------------
// 좌석 배치도(FloorEditor.tsx/MobileSeat.tsx)에서 관리자가 학생을 퇴실 처리할 때, statusAt() 결과(고스트)
// 를 보고 "지금 원 안에 있어야 하는지" vs "원 밖에 있어야 하는지" vs "스케쥴 정보가 아예 없는지"로
// 갈라서 다른 확인 문구·사유 기본값을 보여주기 위한 순수 분류 함수. 두 화면이 판정 기준을 공유해야
// 갈리지 않는다.
export type CheckoutBranch =
  | { kind: "inside"; label: string }               // (가) 자습/쉬는시간/원내 수업/주간 상담 — 사유 선택 필수
  | { kind: "outside"; label: string; slot?: DaySlot } // (나) 외부 학원/외부 일정/기타/등원전/하원 — 사유 기본값 = label
  | { kind: "none" };                                // (다) 스케쥴 정보 자체가 없음

export function checkoutBranchOf(
  ghost: { state: "scheduled" | "study" | "break" | "away" | "none"; label: string; slot?: DaySlot } | undefined,
): CheckoutBranch {
  if (!ghost || ghost.state === "none") return { kind: "none" };
  if (ghost.state === "study" || ghost.state === "break") return { kind: "inside", label: ghost.label };
  if (ghost.state === "scheduled") {
    const isInside = ghost.label === "원내 수업" || ghost.label === "주간 상담";
    return isInside ? { kind: "inside", label: ghost.label } : { kind: "outside", label: ghost.label, slot: ghost.slot };
  }
  return { kind: "outside", label: ghost.label }; // away(등원전/하원)
}

/** statusAt() + checkoutBranchOf() 를 한 번에 — 퇴실 확인창처럼 "그 순간의 분류"만 필요할 때 쓴다.
 * ghostOf(FloorEditor.tsx/MobilePatrol.tsx)와 같은 새벽 시간대(0~5시) +1440 재시도 규칙을 그대로
 * 적용한다(자정 넘김 스케쥴 대비) — actual(firstInMin/lastOutMin)도 재시도 시 함께 +1440 시프트해야
 * minute 좌표계와 어긋나지 않는다. */
export function checkoutBranchAt(
  minute: number,
  hours: { arrive_min: number; leave_min: number } | null,
  slots: DaySlot[],
  periods: Period[],
  actual: ActualAttendance | null,
): CheckoutBranch {
  let result = statusAt(minute, hours, slots, periods, actual);
  if (result.state === "away" && minute < 300) {
    const shifted: ActualAttendance | null = actual
      ? {
          firstInMin: actual.firstInMin != null ? actual.firstInMin + 1440 : actual.firstInMin,
          lastOutMin: actual.lastOutMin != null ? actual.lastOutMin + 1440 : actual.lastOutMin,
        }
      : null;
    const alt = statusAt(minute + 1440, hours, slots, periods, shifted);
    if (alt.state !== "away") result = alt;
  }
  return checkoutBranchOf(result);
}

export type BlockStyle = { bg: string; bd: string; fg: string };

/**
 * 스케쥴러 타임테이블 블록(마킹된 실제 일정)의 배경·테두리·글자색을 사유(reason) 기준으로 계산한다.
 * 고스트(ghostStyleOf)와 같은 SEMANTIC 기준색을 공유하되, 고스트보다 훨씬 진하게 쓴다:
 * - bg: 기준색을 tint(기본 16%)로 섞은 옅은 채움(고스트의 ghostTint 12%보다 살짝 진함 — 실제
 *   확정 일정이라 존재감이 더 필요).
 * - bd: 기준색 그대로(line, 테두리는 원색).
 * - fg: ink — 기준색을 어둡게 눌러(검정 78% 섞음) 옅은 배경 위에서도 대비가 나오게.
 * reason 이 맵에 없는 문구(과거 데이터 등)면 "기타"(none) 색으로 폴백.
 * 순수 함수 — DOM 의존 없음.
 */
export function blockStyleOf(reason: string): BlockStyle {
  const key = REASON_SEMANTIC[reason] ?? REASON_SEMANTIC[GHOST_FALLBACK_REASON];
  return { bg: tint(key), bd: line(key), fg: ink(key) };
}
