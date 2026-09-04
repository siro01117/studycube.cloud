// 직원 근무·수업·상담 일정 — 종류 프리셋 + 겹침 판정 순수 함수.
// 종류는 코드 상수로 고정한다(src/lib/patrol.ts PATROL_STATES 와 같은 방식) — key 는 DB 저장값이라
// 절대 바꾸지 않는다. 색은 새로 만들지 않고 src/lib/semantic-color.ts 의 SEMANTIC 에서 가져온다.
import { type SemanticKey, solid, tint, line } from "./semantic-color";

export type StaffScheduleKind = "counter" | "class" | "counsel";

export type StaffScheduleKindDef = {
  key: StaffScheduleKind;
  label: string;
  needsRoom: boolean; // true면 공간(room) 선택 필수 — 카운터 근무만 공간 없이 사람·시간만.
  dot: string;
  bg: string;
  bd: string;
};

function kindColors(key: SemanticKey): { dot: string; bg: string; bd: string } {
  return { dot: solid(key), bg: tint(key, 16), bd: line(key, 60) };
}

// 순서 = 관리 화면 선택 목록 순서.
export const STAFF_SCHEDULE_KINDS: StaffScheduleKindDef[] = [
  { key: "counter", label: "카운터 근무", needsRoom: false, ...kindColors("present") }, // 사람·시간만
  { key: "class", label: "수업 · 과외", needsRoom: true, ...kindColors("inClass") }, // 사람·시간 + 공간
  { key: "counsel", label: "학부모 상담", needsRoom: true, ...kindColors("counsel") }, // 사람·시간 + 공간
];

export const STAFF_SCHEDULE_BY_KEY: Record<string, StaffScheduleKindDef> = Object.fromEntries(
  STAFF_SCHEDULE_KINDS.map((k) => [k.key, k]),
);

// ── 겹침 판정 (클라·서버 공용 순수 함수 — 이 파일 하나가 단일 출처) ──
// 시각은 이 레포 관례대로 자정부터의 분(start_min/end_min)으로 저장한다(schedule_period 참고).

export type ScheduleBlock = {
  id: string;
  personId: string;
  roomId: string | null;
  date: string; // YYYY-MM-DD
  start: number; // 분
  end: number; // 분
};

/** 두 [start,end) 구간이 겹치는지. 경계가 맞닿기만 하면(한쪽 end === 다른쪽 start) 겹침이 아니다. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type Candidate = {
  id?: string; // 수정 시 자기 자신은 겹침 검사에서 제외
  personId: string;
  roomId: string | null;
  date: string;
  start: number;
  end: number;
};

/** 같은 사람이 시간이 겹치게 배정됐는지 — 종류 무관하게 항상 검사한다. */
export function findPersonConflicts(existing: ScheduleBlock[], cand: Candidate): ScheduleBlock[] {
  return existing.filter(
    (b) =>
      b.id !== cand.id &&
      b.personId === cand.personId &&
      b.date === cand.date &&
      rangesOverlap(b.start, b.end, cand.start, cand.end),
  );
}

/** 같은 공간이 시간이 겹치게 배정됐는지 — 공간이 없는 근무(카운터)는 이 검사 대상이 아니다. */
export function findRoomConflicts(existing: ScheduleBlock[], cand: Candidate): ScheduleBlock[] {
  if (!cand.roomId) return [];
  return existing.filter(
    (b) =>
      b.id !== cand.id &&
      b.roomId === cand.roomId &&
      b.date === cand.date &&
      rangesOverlap(b.start, b.end, cand.start, cand.end),
  );
}

/** 사람 축 + 공간 축 두 검사를 합쳐 한 번에 판정 — 클라 미리보기·서버 검증이 이 함수 하나만 부르면 된다. */
export function findConflicts(
  existing: ScheduleBlock[],
  cand: Candidate,
): { person: ScheduleBlock[]; room: ScheduleBlock[] } {
  return { person: findPersonConflicts(existing, cand), room: findRoomConflicts(existing, cand) };
}

/** 사람별 주간 시간 합계(분) — 시급제 급여 정산의 근거가 될 값이라 관리 화면에 항상 보여준다. */
export function weeklyMinutesByPerson(blocks: { personId: string; start: number; end: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blocks) out[b.personId] = (out[b.personId] ?? 0) + (b.end - b.start);
  return out;
}

/** 분 → "12.5시간" 같은 짧은 라벨(급여 정산 참고용 — 정확한 초 단위가 아니라 시급 계산에 쓰기 좋은 0.5시간 단위). */
export function hoursLabel(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}시간`;
}

/** "HHMM"/"HH:MM"/"HH" 문자열 → 분. ScheduleDemo.tsx normTime 과 동일한 규칙(엄격한 24시간제). */
export function parseClock(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  let h: number, m = 0;
  if (/^\d{3,4}$/.test(t)) { h = +t.slice(0, t.length - 2); m = +t.slice(-2); }
  else if (/^\d{1,2}:\d{2}$/.test(t)) { const [a, b] = t.split(":"); h = +a; m = +b; }
  else if (/^\d{1,2}$/.test(t)) { h = +t; }
  else return null;
  if (h < 0 || h > 27 || m < 0 || m > 59) return null; // 27시까지 허용(익일 새벽 근무 대비 여지 — 지금은 UI에서 23시까지만 씀)
  return h * 60 + m;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** 분 → "HH:MM" 표시. */
export function clockLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 겹치는 구간끼리 레인(나란히 놓일 열)을 배정한다 — 학생 스케쥴러(ScheduleDemo.tsx layoutDay)와
 * 같은 구간-클러스터링 알고리즘을 표시용으로 그대로 옮겨 왔다. 하나의 공유 시간 축 위에서 여러 사람의
 * 블록이 같은 요일·시간대에 겹칠 때(다른 사람끼리는 겹쳐도 정상 — 서버는 같은 사람·같은 공간만 막는다)
 * 이 함수로 나란히 배치한다. */
export function layoutLanes<T extends { start: number; end: number }>(
  items: T[],
): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const out: (T & { lane: number; lanes: number })[] = [];
  let cluster: T[] = [];
  let clusterEnd = -1;
  const clusters: T[][] = [];
  for (const b of sorted) {
    if (cluster.length && b.start < clusterEnd) { cluster.push(b); clusterEnd = Math.max(clusterEnd, b.end); }
    else { if (cluster.length) clusters.push(cluster); cluster = [b]; clusterEnd = b.end; }
  }
  if (cluster.length) clusters.push(cluster);
  for (const c of clusters) c.forEach((b, i) => out.push({ ...b, lane: i, lanes: c.length }));
  return out;
}
