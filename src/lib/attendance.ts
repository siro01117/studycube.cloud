// 출결 일일 상태(결석 사유 등). attendance 테이블의 status/reason 에 대응.
// 'use client' 아님 → 서버 액션·클라 공용.

// 결석 사유 프리셋. 무단결석은 벌점 프리셋(penalty.ts absent=3)과 별개 —
// 결석 상태는 출결 기록이고, 벌점은 필요 시 벌점 모듈에서 따로 부여한다.
export const ABSENCE_REASONS: { key: string; label: string }[] = [
  { key: "sick",      label: "병결" },
  { key: "excused",   label: "사유결" },
  { key: "unexcused", label: "무단결석" },
  { key: "etc",       label: "기타" },
];

export const ABSENCE_BY_KEY: Record<string, string> = Object.fromEntries(
  ABSENCE_REASONS.map((r) => [r.key, r.label]),
);

// 결석 사유 라벨. 프리셋 키면 라벨로, 아니면(직접 입력) 그대로.
export function absenceReasonLabel(reason: string | null): string {
  if (!reason) return "";
  return ABSENCE_BY_KEY[reason] ?? reason;
}
