// 신청·설문 접수 공용(서버·클라). 유형·상태 라벨.
export const SUBMISSION_TYPES = [
  { key: "lunch", label: "도시락" },
  { key: "content", label: "컨텐츠 신청" },
  { key: "counsel", label: "상담 신청" },
  { key: "schedule", label: "스케쥴 제출" },
] as const;

export const SUBMISSION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  SUBMISSION_TYPES.map((t) => [t.key, t.label]),
);

export const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  done: "처리완료",
  rejected: "반려",
};

// 전화번호에서 숫자만 남긴다(매칭용). "010-1234-5678" → "01012345678"
export function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
