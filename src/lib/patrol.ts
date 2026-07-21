// 순찰 상태 프리셋 (정적 우선 원칙 — 코드 상수로 고정, 바꿀 일 생기면 여기 숫자만 수정).
// 'use client' 아님 → 서버 액션/페이지·클라 컴포넌트 공용.
export type PatrolKind = "normal" | "excused" | "penalty";

export type PatrolState = {
  key: string;      // DB 저장 키 (고정)
  label: string;    // 표시
  points: number;   // 벌점 (0 = 벌점 아님) — 기본값, 필요 시 여기서 조정
  kind: PatrolKind; // normal=정상 / excused=사유있는 이석 / penalty=벌점
  present: boolean; // 자리에 있음(재석) 여부 — 입석·수면·딴짓=true, 자리비움·학원·상담=false
  dot: string;      // 상태 점 색
  bg: string;       // 좌석 배경
  bd: string;       // 좌석 테두리
};

// 순서 = 순찰 메뉴에 뜨는 순서. 재석(자리에 있음) 먼저, 그다음 이석(자리 비움).
export const PATROL_STATES: PatrolState[] = [
  // ── 재석: 자리에 있음 ──
  { key: "seated",   label: "입석", points: 0, kind: "normal",  present: true,  dot: "#12b886", bg: "rgba(18,184,134,.15)", bd: "rgba(18,184,134,.55)" },
  { key: "sleep",    label: "수면", points: 1, kind: "penalty", present: true,  dot: "#e5484d", bg: "rgba(229,72,77,.15)",  bd: "rgba(229,72,77,.5)" },
  { key: "distract", label: "딴짓", points: 2, kind: "penalty", present: true,  dot: "#f76808", bg: "rgba(247,104,8,.15)",  bd: "rgba(247,104,8,.5)" },
  // ── 이석: 자리 비움 ──
  { key: "away",     label: "자리비움", points: 2, kind: "penalty", present: false, dot: "#c98a2b", bg: "rgba(201,138,43,.16)", bd: "rgba(201,138,43,.5)" },  // 무단이탈
  { key: "academy",  label: "학원",     points: 0, kind: "excused", present: false, dot: "#5b8def", bg: "rgba(91,141,239,.14)", bd: "rgba(91,141,239,.5)" },
  { key: "counsel",  label: "상담",     points: 0, kind: "excused", present: false, dot: "#9b7dff", bg: "rgba(155,125,255,.15)", bd: "rgba(155,125,255,.5)" },
];

export const PATROL_BY_KEY: Record<string, PatrolState> = Object.fromEntries(
  PATROL_STATES.map((s) => [s.key, s]),
);

export function patrolPoints(key: string): number {
  return PATROL_BY_KEY[key]?.points ?? 0;
}
