"use client";

// 순찰 기록 모듈. 왼쪽 = 순찰 세션 목록, 오른쪽 = 선택한 순찰 당시 좌석 표시(색) 재현 + 수정.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { PATROL_STATES, PATROL_BY_KEY } from "@/lib/patrol";
import ContextMenu, { type MenuItem } from "../_shared/ContextMenu";
import { getPatrolSessions, getPatrolSessionDetail, setPatrolMark, clearPatrolMark, deletePatrolSession } from "../seat/patrolActions";

export type PRoom = { id: string; name: string; floor: number };
export type PSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string; current_student_id: string | null };
export type PStudent = { id: string; name: string };
type Session = { id: string; started_at: string; ended_at: string | null; marked: number; penalty: number };
// 좌석 기준 마크(당시 그 자리에 찍힌 기록) — seat_id 로 매핑
type SeatMark = { studentId: string; name: string; state: string; points: number };

const SW = 82, SH = 60, CELL_X = 100, CELL_Y = 80, ORIGIN = 40, PER_ROW = 6;
const xyOf = (s: PSeat, i: number) => ({
  x: s.grid_x == null ? ORIGIN + (i % PER_ROW) * CELL_X : s.grid_x,
  y: s.grid_y == null ? ORIGIN + Math.floor(i / PER_ROW) * CELL_Y : s.grid_y,
});
const boundsOf = (pts: { x: number; y: number }[]) => {
  if (!pts.length) return { w: 260, h: 160 };
  return { w: Math.max(...pts.map((p) => p.x + SW)) + 32, h: Math.max(...pts.map((p) => p.y + SH)) + 32 };
};

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateKey = (iso: string) => keyOf(new Date(iso));
const labelDate = (key: string) => { const [y, m, d] = key.split("-").map(Number); return keyOf(new Date()) === key ? "오늘" : new Date(y, m - 1, d).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }); };
const fmtDur = (a: string, b: string | null) => {
  if (!b) return "진행 중";
  const sec = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  const m = Math.floor(sec / 60), ss = sec % 60;
  return m > 0 ? `${m}분 ${ss}초` : `${ss}초`;
};

export default function PatrolBoard({
  rooms, seats, students, sessions: initialSessions, canManage,
}: {
  rooms: PRoom[]; seats: PSeat[]; students: PStudent[]; sessions: Session[]; canManage: boolean;
}) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [selDate, setSelDate] = useState<string>(initialSessions[0] ? dateKey(initialSessions[0].started_at) : keyOf(new Date()));
  const [selId, setSelId] = useState<string | null>(initialSessions[0]?.id ?? null);
  const [marks, setMarks] = useState<Record<string, SeatMark>>({}); // seat_id → 마크
  const selRef = useRef<string | null>(selId);
  selRef.current = selId;
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; seat: PSeat } | null>(null);
  const [, start] = useTransition();

  const nameOf = useMemo(() => { const m = new Map<string, string>(); for (const s of students) m.set(s.id, s.name); return m; }, [students]);
  const seatsByRoom = useMemo(() => {
    const m = new Map<string, PSeat[]>();
    for (const s of seats) { if (!s.room_id) continue; (m.get(s.room_id) ?? m.set(s.room_id, []).get(s.room_id)!).push(s); }
    return m;
  }, [seats]);
  const floors = useMemo(() => Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b), [rooms]);
  const sel = sessions.find((s) => s.id === selId) ?? null;
  // 선택 날짜의 순찰만
  const visible = useMemo(() => sessions.filter((s) => dateKey(s.started_at) === selDate), [sessions, selDate]);
  // 날짜 바뀌면(또는 목록 변화) 선택 세션이 그 날짜에 없으면 그 날 첫 순찰로
  useEffect(() => {
    if (selId && visible.some((s) => s.id === selId)) return;
    setSelId(visible[0]?.id ?? null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마크 로드 — 응답이 늦게 와도 지금 선택된 세션이 아니면 무시(레이스 방지)
  const loadMarks = (sid: string) => {
    getPatrolSessionDetail(sid).then((rows) => {
      if (selRef.current !== sid) return;
      const m: Record<string, SeatMark> = {};
      for (const r of rows) if (r.seat_id) m[r.seat_id] = { studentId: r.student_id, name: r.name, state: r.state, points: r.points };
      setMarks(m);
    }).catch(() => {});
  };

  useEffect(() => {
    if (!selId) { setMarks({}); return; }
    loadMarks(selId);
  }, [selId]);

  const reload = () => {
    getPatrolSessions().then(setSessions).catch(() => {});
    if (selId) loadMarks(selId);
  };

  const editMark = (studentId: string, seatId: string, state: string) => {
    if (!selId) return;
    const fd = new FormData(); fd.set("sessionId", selId); fd.set("studentId", studentId); fd.set("seatId", seatId); fd.set("state", state);
    start(async () => { await setPatrolMark(fd); reload(); });
  };
  const clearMark = (studentId: string) => {
    if (!selId) return;
    const fd = new FormData(); fd.set("sessionId", selId); fd.set("studentId", studentId);
    start(async () => { await clearPatrolMark(fd); reload(); });
  };
  const delSession = (id: string) => {
    const fd = new FormData(); fd.set("sessionId", id);
    start(async () => {
      await deletePatrolSession(fd);
      const rows = await getPatrolSessions().catch(() => sessions.filter((s) => s.id !== id));
      setSessions(rows); setConfirmDel(null);
      if (selId === id) setSelId(rows[0]?.id ?? null);
    });
  };

  const menuItems = (seat: PSeat): MenuItem[] => {
    const mark = marks[seat.id];
    const targetId = mark?.studentId ?? seat.current_student_id; // 기존 기록 학생 우선, 없으면 현재 점유자
    if (!targetId) return [{ label: "빈자리", disabled: true }];
    const cur = mark?.state;
    const mk = (st: (typeof PATROL_STATES)[number]): MenuItem => ({
      label: st.label + (cur === st.key ? " ✓" : ""),
      dot: st.dot,
      right: st.points > 0 ? `+${st.points}` : undefined,
      onClick: () => editMark(targetId, seat.id, st.key),
    });
    return [
      { label: "자리에 있음", disabled: true },
      ...PATROL_STATES.filter((st) => st.present).map(mk),
      { separator: true },
      { label: "자리 비움", disabled: true },
      ...PATROL_STATES.filter((st) => !st.present).map(mk),
      { separator: true },
      { label: "이 기록 지우기", onClick: () => clearMark(targetId), danger: true, disabled: !cur },
    ];
  };

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* 왼쪽: 날짜 선택 + 그 날 순찰 목록 */}
      <div style={{ flex: "none", width: 300, borderRight: "1px solid var(--line)", background: "var(--card)", overflowY: "auto", padding: 12 }}>
        <div style={{ marginBottom: 10 }}>
          <input type="date" className="input" value={selDate} max={keyOf(new Date())} onChange={(e) => setSelDate(e.target.value || keyOf(new Date()))} aria-label="순찰 날짜" style={{ height: 40, fontSize: 14 }} />
          <div style={{ fontSize: 11.5, color: "var(--faint)", margin: "6px 2px 0" }}>{labelDate(selDate)} · 순찰 {visible.length}회</div>
        </div>
        {visible.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>{sessions.length === 0 ? "순찰 기록이 없습니다." : "이 날짜엔 순찰 기록이 없습니다."}</div>
        ) : visible.map((ps) => {
          const on = ps.id === selId;
          return (
            <div key={ps.id} style={{ border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, borderRadius: 12, marginBottom: 8, overflow: "hidden", background: on ? "var(--accent-soft)" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <button onClick={() => setSelId(ps.id)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtTime(ps.started_at)}{ps.ended_at ? `–${fmtTime(ps.ended_at)}` : ""}</div>
                    <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>소요 {fmtDur(ps.started_at, ps.ended_at)} · 점검 {ps.marked}명</div>
                  </div>
                  {ps.penalty > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: "#e5484d", borderRadius: 8, padding: "2px 7px" }}>{ps.penalty}</span>}
                </button>
                {canManage && (confirmDel === ps.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 6px" }}>
                    <button onClick={() => delSession(ps.id)} style={{ height: 24, padding: "0 7px", fontSize: 11.5, fontWeight: 700, border: "none", borderRadius: 6, background: "var(--danger)", color: "#fff", cursor: "pointer" }}>삭제</button>
                    <button onClick={() => setConfirmDel(null)} style={{ height: 24, padding: "0 6px", fontSize: 11.5, border: "1px solid var(--line)", borderRadius: 6, background: "transparent", color: "var(--dim)", cursor: "pointer" }}>취소</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDel(ps.id)} title="이 순찰 기록 삭제" style={{ border: "none", background: "transparent", padding: "0 10px", cursor: "pointer", color: "var(--faint)", display: "grid", placeItems: "center" }}>
                    <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 오른쪽: 선택한 순찰의 좌석 표시 재현 */}
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 20 }}>
        {!sel ? (
          <div style={{ color: "var(--faint)", fontSize: 14, paddingTop: 40, textAlign: "center" }}>왼쪽에서 순찰을 선택하세요.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{fmtDate(sel.started_at)} {fmtTime(sel.started_at)}{sel.ended_at ? `–${fmtTime(sel.ended_at)}` : ""}</span>
              <span style={{ fontSize: 12.5, color: "var(--dim)" }}>점검 {sel.marked}명 · 벌점 <b style={{ color: "#e5484d" }}>{sel.penalty}점</b></span>
              {canManage && <span style={{ fontSize: 12, color: "var(--faint)" }}>좌석을 클릭해 상태를 수정할 수 있어요</span>}
            </div>
            {/* 범례 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginBottom: 16 }}>
              {PATROL_STATES.map((st) => (
                <span key={st.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--dim)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: st.dot }} />{st.label}{st.points > 0 ? ` +${st.points}` : ""}
                </span>
              ))}
            </div>

            {floors.map((fl) => {
              const froomsAll = rooms.filter((r) => r.floor === fl);
              return (
                <div key={fl} style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sub)", marginBottom: 8 }}>{fl}층</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    {froomsAll.map((room) => {
                      const rs = seatsByRoom.get(room.id) ?? [];
                      const pos = rs.map((s, i) => ({ s, ...xyOf(s, i) }));
                      const { w, h } = boundsOf(pos);
                      return (
                        <div key={room.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12, background: "var(--card)" }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{room.name}</div>
                          <div style={{ position: "relative", width: w, height: h }}>
                            {pos.map(({ s, x, y }) => {
                              const mark = marks[s.id];                                   // 그 세션에 이 자리에 찍힌 기록(당시 학생)
                              const st = mark ? PATROL_BY_KEY[mark.state] : undefined;
                              const who = mark ? mark.name : (s.current_student_id ? nameOf.get(s.current_student_id) ?? null : null);
                              const occupied = !!mark || !!s.current_student_id;
                              const style: CSSProperties = {
                                position: "absolute", left: x, top: y, width: SW, height: SH,
                                borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel2)",
                                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                                cursor: canManage && occupied ? "pointer" : "default", overflow: "hidden",
                              };
                              if (st) { style.background = st.bg; style.borderColor = st.bd; }
                              else if (occupied) { style.borderColor = "rgba(120,130,150,.35)"; }
                              return (
                                <div
                                  key={s.id}
                                  className="touchable"
                                  onClick={canManage && occupied ? (e) => setMenu({ x: e.clientX, y: e.clientY, seat: s }) : undefined}
                                  style={style}
                                >
                                  <span style={{ position: "absolute", top: 3, left: 6, fontSize: 9.5, fontWeight: 700, color: "var(--faint)" }}>{s.number ?? s.label}</span>
                                  {who ? (
                                    <>
                                      <span style={{ fontSize: 12.5, fontWeight: 700, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: st ? st.dot : "var(--faint)" }}>{st ? st.label : "미점검"}</span>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: 11, color: "var(--faint)" }}>공석</span>
                                  )}
                                  {mark && mark.points > 0 && (
                                    <span style={{ position: "absolute", bottom: 3, right: 5, fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#e5484d", borderRadius: 7, padding: "0 5px", lineHeight: "14px" }}>{mark.points}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={`${menu.seat.number ?? menu.seat.label}번 · ${marks[menu.seat.id]?.name ?? (menu.seat.current_student_id ? nameOf.get(menu.seat.current_student_id) ?? "" : "")} — 수정`}
          items={menuItems(menu.seat)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
