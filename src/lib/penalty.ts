// 벌점 사유 프리셋 (정적 우선 — 코드 상수로 고정). 순찰(patrol_event.points)과 합산해 이번 주 누적 산출.
// 'use client' 아님 → 서버 액션/페이지·클라 공용.
export type PenaltyReason = {
  key: string;      // DB 저장 키(고정)
  label: string;
  points: number;   // 부여 점수
};

// 순서 = 부여 메뉴에 뜨는 순서. 정정은 별도 차감이 아니라 내역에서 해당 기록을 삭제(누적 = 내역 합산).
export const PENALTY_REASONS: PenaltyReason[] = [
  { key: "late",     label: "지각",             points: 1 },
  { key: "phone",    label: "휴대폰 사용",       points: 2 },
  { key: "noise",    label: "면학분위기 저해",   points: 2 },
  { key: "homework", label: "과제 미제출",       points: 2 },
  { key: "leave",    label: "무단외출·이탈",     points: 3 },
  { key: "absent",   label: "무단결석",         points: 3 },
  { key: "etc",      label: "기타",             points: 1 },
];

export const PENALTY_BY_KEY: Record<string, PenaltyReason> = Object.fromEntries(
  PENALTY_REASONS.map((r) => [r.key, r]),
);

// 이 점수 이상이면 경고(주의 학생)
export const PENALTY_WARN = 5;

// 누적 벌점 → 히트 색(좌석/뱃지). 0=중립, 높을수록 진한 빨강.
export function penaltyHeat(points: number): { bg: string; bd: string; fg: string } {
  if (points <= 0) return { bg: "var(--panel2)", bd: "var(--line)", fg: "var(--faint)" };
  if (points < 3) return { bg: "rgba(201,138,43,.14)", bd: "rgba(201,138,43,.45)", fg: "#b06f1c" };
  if (points < PENALTY_WARN) return { bg: "rgba(247,104,8,.15)", bd: "rgba(247,104,8,.5)", fg: "#c9510a" };
  return { bg: "rgba(229,72,77,.18)", bd: "rgba(229,72,77,.6)", fg: "#c92a2f" };
}

// 이번 주 시작(가장 최근 월요일) — 벌점은 매주 월요일 리셋 = 이 날짜부터 집계.
export function weekStartKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();               // 0=일 … 6=토
  const diff = day === 0 ? 6 : day - 1; // 월요일까지 되돌릴 일수
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function weekStartLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
