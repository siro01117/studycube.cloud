// 좌석 배치도의 "지금 재실/부재" 판정 — 오늘 그 학생의 마지막 순찰 기록(patrol_event)과
// 마지막 출결 기록(attendance_event) 중 시각이 더 늦은 쪽을 따른다. 시각이 같으면 사람이 직접
// 누른 수동 기록(attendance_event)을 우선한다.
// /m/seat(FloorEditor)와 /seat(MobileSeat) 두 화면이 이 로직을 공유해 판정이 갈리지 않게 한다.
// 서버(page.tsx)에서만 호출 — Date.parse 로 절대 시각을 비교하고, title 은 timeLabel 로 미리
// 포맷해 내려준다(클라 렌더에서 new Date()/toLocale* 호출 금지 원칙 준수).
import { PATROL_BY_KEY } from "./patrol";
import { timeLabel } from "./date";

export type OccKind = "in" | "out";
export type SeatOcc = { kind: OccKind; title: string };

export type LastAttRow = { student_id: string; kind: string; at: string; auto: boolean; note?: string | null };
export type LastPatrolRow = { student_id: string; state: string | null; at: string | null };

export function buildOccupancy(attRows: LastAttRow[], patrolRows: LastPatrolRow[]): Record<string, SeatOcc> {
  const attMap = new Map(attRows.map((r) => [r.student_id, r]));
  const patMap = new Map(patrolRows.map((r) => [r.student_id, r]));
  const ids = new Set<string>([...attMap.keys(), ...patMap.keys()]);
  const occ: Record<string, SeatOcc> = {};
  for (const sid of ids) {
    const a = attMap.get(sid);
    const p = patMap.get(sid);
    const aMs = a ? Date.parse(a.at) : -Infinity;
    const pMs = p?.at ? Date.parse(p.at) : -Infinity;
    if (p?.at && pMs > aMs) {
      // 순찰이 더 최신 — 순찰 프리셋의 asIn 으로 재실/부재 간주
      const cfg = p.state ? PATROL_BY_KEY[p.state] : undefined;
      const asIn = cfg?.asIn ?? true;
      occ[sid] = {
        kind: asIn ? "in" : "out",
        title: `순찰 ${timeLabel(p.at)} · ${cfg?.label ?? p.state} · ${asIn ? "입실 간주" : "퇴실 간주"}`,
      };
    } else if (a) {
      // 출결이 더 최신이거나(또는 동시각), 순찰 기록이 아예 없음
      const kind: OccKind = a.kind === "in" ? "in" : "out";
      occ[sid] = {
        kind,
        title: `${a.auto ? "자동" : "수동"} ${timeLabel(a.at)} · ${kind === "in" ? "입실" : "퇴실"}${a.note ? ` · ${a.note}` : ""}`,
      };
    }
  }
  return occ;
}
