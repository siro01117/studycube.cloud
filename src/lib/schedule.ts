// 학생 스케쥴러 파생 판정 — 등하원 시각 + 일정 블록만으로 "지금 무엇을 하고 있어야 하는가"를 계산한다.
// 자습은 저장하지 않는다: 다른 일정이 없고 등원~하원 사이면 자습으로 간주(파생 상태).
// 순수 함수 — DOM·DB 의존 없음. 순찰 화면 등에서 재사용할 수 있도록 여기 둔다(이번 작업 범위에선 연동하지 않음).

export type DaySlot = { start: number; end: number; reason: string; kind: string };

/**
 * 특정 요일·시각에 학생이 무엇을 하고 있어야 하는지 판정한다.
 * 우선순위: 일정 블록(scheduled) > 자습(study) > 등원전/하원(away).
 * - slots 중 minute 을 포함하는 블록이 있으면 scheduled + 그 사유 라벨.
 * - 없고 hours 가 있고 arrive_min <= minute < leave_min 이면 study + "자습".
 * - 그 외 state 는 "away" 로 유지(호출부 호환)하되 label 은 시각에 따라 세분화:
 *   등하원 정보가 있고 minute < arrive_min → "등원전", minute >= leave_min → "하원".
 *   등하원 정보 자체가 없으면 "등원전".
 * 자정 넘김(1440 초과) 좌표계를 그대로 쓴다(호출부가 minute 을 그 좌표계로 넘겨야 함).
 */
export function statusAt(
  minute: number,
  hours: { arrive_min: number; leave_min: number } | null,
  slots: DaySlot[],
): { state: "scheduled" | "study" | "away"; label: string; slot?: DaySlot } {
  const hit = slots.find((s) => minute >= s.start && minute < s.end);
  if (hit) return { state: "scheduled", label: hit.reason, slot: hit };
  if (hours && minute >= hours.arrive_min && minute < hours.leave_min) {
    return { state: "study", label: "자습" };
  }
  if (hours && minute >= hours.leave_min) {
    return { state: "away", label: "하원" };
  }
  return { state: "away", label: "등원전" };
}

/**
 * 기준 시각(minute)으로부터 withinMin 분 이내에 시작하는 다음 일정을 찾는다. 없으면 null.
 * slot.start > minute 인 것 중 가장 이른 것을 고르고, 그 시작까지 남은 분(inMin)이
 * withinMin 이하일 때만 반환한다. 자정 넘김(1440 초과) 좌표계를 그대로 쓴다(statusAt 과 동일하게
 * 호출부가 minute·slots 를 같은 좌표계로 맞춰 넘겨야 한다). 순수 함수 — DOM·DB 의존 없음.
 */
export function upcomingAt(
  minute: number,
  slots: DaySlot[],
  withinMin = 60,
): { inMin: number; slot: DaySlot } | null {
  let best: DaySlot | null = null;
  for (const s of slots) {
    if (s.start <= minute) continue;
    if (!best || s.start < best.start) best = s;
  }
  if (!best) return null;
  const inMin = best.start - minute;
  if (inMin > withinMin) return null;
  return { inMin, slot: best };
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
 * - away(등원전/하원): 채도 없이 좌석 전체를 흐리게(opacity) + 중립 배경, 스트립 없음.
 * reason 은 statusAt() 이 돌려준 label 을 그대로 넘기면 된다(모르는 문구가 오면 "기타" 색으로 대체).
 * 순수 함수 — DOM 의존 없음(CSS 색 문자열만 반환, color-mix 는 브라우저가 렌더링 시점에 계산).
 */
export function ghostStyleOf(state: 'scheduled' | 'study' | 'away' | 'none', reason?: string): GhostStyle {
  if (state === 'none') {
    // 스케쥴 데이터 자체가 없는 학생 — "부재"가 아니라 "정보 없음"이라 away(0.55)보다는 덜 흐리게(0.75).
    return { bg: ghostTint('none'), strip: line('none'), dim: 0.75 };
  }
  if (state === 'away') {
    return { bg: 'var(--panel2)', strip: undefined, dim: 0.55 };
  }
  if (state === 'study') {
    return { bg: ghostTint('present', 4), strip: 'var(--line)', dim: 1 };
  }
  const key = REASON_SEMANTIC[reason ?? ''] ?? REASON_SEMANTIC[GHOST_FALLBACK_REASON];
  return { bg: ghostTint(key), strip: line(key), dim: 1 };
}

/**
 * 순찰 "미점검" 집계(경고·점검 N/M 분모)에서 제외할 학생인지 — 고스트 상태가 없음(스케쥴 정보 자체가
 * scheduleMap 에 없어 ghostOf 에 엔트리가 안 잡힌 경우 = 미설정) 또는 away(등원전/하원)면 제외한다.
 * study(자습)·scheduled(일정)는 정상 집계 대상. 제외돼도 탭해서 찍으면 그 기록은 그대로 남는다
 * (이 함수는 집계용일 뿐 입력 자체를 막지 않는다). 모바일(MobilePatrol.tsx)·데스크탑(FloorEditor.tsx) 공용.
 */
export function isPatrolExempt(state: "scheduled" | "study" | "away" | "none" | undefined): boolean {
  return state === undefined || state === "none" || state === "away";
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
