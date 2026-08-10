// 학생 스케쥴러 파생 판정 — 등하원 시각 + 일정 블록만으로 "지금 무엇을 하고 있어야 하는가"를 계산한다.
// 자습은 저장하지 않는다: 다른 일정이 없고 등원~하원 사이면 자습으로 간주(파생 상태).
// 순수 함수 — DOM·DB 의존 없음. 순찰 화면 등에서 재사용할 수 있도록 여기 둔다(이번 작업 범위에선 연동하지 않음).

export type DaySlot = { start: number; end: number; reason: string; kind: string };

/**
 * 특정 요일·시각에 학생이 무엇을 하고 있어야 하는지 판정한다.
 * 우선순위: 일정 블록(scheduled) > 자습(study) > 미등원(away).
 * - slots 중 minute 을 포함하는 블록이 있으면 scheduled + 그 사유 라벨.
 * - 없고 hours 가 있고 arrive_min <= minute < leave_min 이면 study + "자습".
 * - 그 외 away + "미등원".
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
  return { state: "away", label: "미등원" };
}
