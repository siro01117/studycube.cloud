"use client";

// 폰용 순찰 기록 — 세션 목록에서 하나 골라 그때 찍힌 학생 상태를 리스트로 본다.
// 데스크톱(좌석 배치 재현)과 달리 리스트로: 폰에서는 "누가 뭐였나"만 보면 된다.
import { useEffect, useMemo, useState, useTransition } from "react";
import MobileNav from "../_shared/MobileNav";
import SeatCanvas from "../_shared/SeatCanvas";
import { SW, xyOf } from "@/lib/seatmap";
import { PATROL_BY_KEY } from "@/lib/patrol";
import { getPatrolSessionDetail, clearPatrolMark, setPatrolMark } from "../m/seat/patrolActions";

// 표시 문자열은 서버에서 만들어 받는다(클라 날짜 포맷 = 하이드레이션 불일치 원인).
export type Session = { id: string; dayLabel: string; timeLabel: string; durLabel: string; marked: number; penalty: number };
export type RRoom = { id: string; name: string; floor: number };
export type RSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string };
type Detail = { student_id: string; seat_id: string | null; name: string; state: string; points: number; at: string };

export default function MobileRecords({ sessions, rooms, seats, canManage }: {
  sessions: Session[]; rooms: RRoom[]; seats: RSeat[]; canManage: boolean;
}) {
  const [selId, setSelId] = useState<string | null>(sessions[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail[] | null>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [view, setView] = useState<"map" | "list">("map");   // 순찰할 때처럼 좌석 배치도로 보기가 기본
  const [roomIdx, setRoomIdx] = useState(0);
  const [, start] = useTransition();

  const byRoom = useMemo(() => {
    const m = new Map<string, RSeat[]>();
    for (const s of seats) { if (!s.room_id) continue; (m.get(s.room_id) ?? m.set(s.room_id, []).get(s.room_id)!).push(s); }
    return m;
  }, [seats]);
  const room = rooms[roomIdx] ?? null;
  const roomSeats = useMemo(() => (room ? byRoom.get(room.id) ?? [] : []), [room, byRoom]);
  const canvasSeats = useMemo(() => roomSeats.map((s, i) => ({ id: s.id, ...xyOf(s, i) })), [roomSeats]);
  const seatById = useMemo(() => new Map(roomSeats.map((s) => [s.id, s])), [roomSeats]);
  // 그 순찰 당시 이 자리에 찍힌 기록 (seat_id 스냅샷 기준)
  const bySeat = useMemo(() => {
    const m = new Map<string, Detail>();
    for (const d of detail ?? []) if (d.seat_id) m.set(d.seat_id, d);
    return m;
  }, [detail]);

  const sel = useMemo(() => sessions.find((s) => s.id === selId) ?? null, [sessions, selId]);

  useEffect(() => {
    if (!selId) { setDetail(null); return; }
    let alive = true;
    setDetail(null);
    getPatrolSessionDetail(selId).then((r) => { if (alive) setDetail(r); }).catch(() => { if (alive) setDetail([]); });
    return () => { alive = false; };
  }, [selId]);

  const reload = (sid: string) => getPatrolSessionDetail(sid).then(setDetail).catch(() => {});

  const change = (studentId: string, seatId: string | null, state: string | null) => {
    if (!selId) return;
    const fd = new FormData();
    fd.set("sessionId", selId); fd.set("studentId", studentId);
    if (state) { fd.set("state", state); if (seatId) fd.set("seatId", seatId); }
    start(async () => {
      await (state ? setPatrolMark(fd) : clearPatrolMark(fd));
      await reload(selId);
    });
    setEdit(null);
  };

  // 벌점 있는 것부터 — 폰에서는 "문제였던 학생"이 위로
  const rows = useMemo(
    () => (detail ?? []).slice().sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    [detail],
  );

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* 상단 */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <MobileNav current="/records" />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>순찰 기록</div>
          <div style={{ fontSize: 11, color: "var(--faint)" }}>
            {view === "map" && room ? `${room.floor}층 ${room.name} · 방 ${roomIdx + 1}/${rooms.length}` : `최근 ${sessions.length}회`}
          </div>
        </div>
        {/* 좌석 배치도 ↔ 목록 */}
        <button onClick={() => setView((v) => (v === "map" ? "list" : "map"))}
          aria-label={view === "map" ? "목록으로 보기" : "좌석 배치도로 보기"}
          style={{ width: 40, height: 40, border: "none", background: "transparent", color: "var(--sub)", display: "grid", placeItems: "center", cursor: "pointer", flex: "none" }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {view === "map"
              ? <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>
              : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>}
          </svg>
        </button>
      </div>

      {/* 세션 선택 — 가로 스크롤 칩 */}
      <div style={{ flex: "none", display: "flex", gap: 6, overflowX: "auto", padding: "10px 12px", background: "var(--card)", borderBottom: "1px solid var(--line)", touchAction: "pan-x" }}>
        {sessions.length === 0 && <span style={{ fontSize: 13, color: "var(--faint)" }}>순찰 기록이 없습니다.</span>}
        {sessions.map((s) => {
          const on = s.id === selId;
          return (
            <button key={s.id} onClick={() => setSelId(s.id)}
              style={{
                flex: "none", minHeight: 52, padding: "6px 13px", borderRadius: 12, cursor: "pointer",
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: on ? "var(--accent-soft)" : "var(--bg)",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
              }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: on ? "var(--accent)" : "var(--ink)", whiteSpace: "nowrap" }}>
                {s.dayLabel} {s.timeLabel}
              </span>
              <span style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>
                {s.marked}명 · 벌점 {s.penalty}
              </span>
            </button>
          );
        })}
      </div>

      {/* 선택 세션 요약 */}
      {sel && (
        <div style={{ flex: "none", display: "flex", gap: 14, padding: "10px 14px", fontSize: 12.5, color: "var(--dim)" }}>
          <span>소요 <b style={{ color: "var(--ink)" }}>{sel.durLabel}</b></span>
          <span>점검 <b style={{ color: "var(--ink)" }}>{sel.marked}명</b></span>
          <span>벌점 <b style={{ color: sel.penalty ? "var(--danger)" : "var(--ink)" }}>{sel.penalty}점</b></span>
        </div>
      )}

      {/* 좌석 배치도 뷰 — 순찰할 때와 같은 화면에서 그때 상태를 재현 */}
      {view === "map" && (
        <>
          <SeatCanvas
            seats={canvasSeats}
            onTap={(id) => { const d = bySeat.get(id); if (d && canManage) setEdit(d); }}
            renderSeat={(id) => {
              const s = seatById.get(id)!;
              const d = bySeat.get(id);
              const p = d ? PATROL_BY_KEY[d.state] : undefined;
              return (
                <div style={{
                  width: "100%", height: "100%", borderRadius: 10,
                  background: p ? p.bg : "var(--panel2)",
                  border: `1.5px solid ${p ? p.bd : "var(--line)"}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  position: "relative", opacity: d ? 1 : 0.5,
                }}>
                  <span style={{ position: "absolute", top: 2, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--faint)" }}>{s.number ?? s.label}</span>
                  {d ? (
                    <div style={{ marginTop: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--sub)", maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 800, color: p?.dot, lineHeight: 1.1 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: p?.dot }} />{p?.label ?? d.state}
                      </span>
                    </div>
                  ) : <span style={{ fontSize: 11, color: "var(--faint)", marginTop: 10 }}>기록 없음</span>}
                </div>
              );
            }}
          />
          {/* 방 이동 */}
          <div style={{ flex: "none", display: "flex", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "var(--card)", borderTop: "1px solid var(--line)" }}>
            <button className="btn" disabled={roomIdx === 0} onClick={() => setRoomIdx((i) => Math.max(0, i - 1))} style={{ height: 54, flex: "0 0 64px", fontSize: 20 }} aria-label="이전 방">‹</button>
            <div className="btn" style={{ height: 54, flex: 1, cursor: "default", fontSize: 14, fontWeight: 700, color: "var(--sub)" }}>
              {room ? `${room.floor}층 ${room.name}` : "-"}
            </div>
            <button className="btn" disabled={roomIdx >= rooms.length - 1} onClick={() => setRoomIdx((i) => Math.min(rooms.length - 1, i + 1))} style={{ height: 54, flex: "0 0 64px", fontSize: 20 }} aria-label="다음 방">›</button>
          </div>
        </>
      )}

      {/* 학생별 기록(목록) */}
      {view === "list" && (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 12px calc(16px + env(safe-area-inset-bottom))" }}>
        {detail === null && selId && <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13.5, padding: 30 }}>불러오는 중…</div>}
        {detail?.length === 0 && <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13.5, padding: 30 }}>이 순찰에 기록된 학생이 없습니다.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => {
            const p = PATROL_BY_KEY[r.state];
            return (
              <button key={r.student_id} onClick={() => canManage && setEdit(r)}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "0 14px", borderRadius: 14, border: "1px solid var(--line)", background: "var(--card)", cursor: canManage ? "pointer" : "default", textAlign: "left" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: 700 }}>{r.name}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 800, color: p?.dot ?? "var(--sub)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p?.dot ?? "var(--faint)" }} />
                  {p?.label ?? r.state}
                </span>
                {r.points > 0 && <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)", minWidth: 28, textAlign: "right" }}>+{r.points}</span>}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* 정정 시트 */}
      {edit && canManage && (
        <>
          <div onClick={() => setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 19, fontWeight: 800 }}>{edit.name}</span>
              <span style={{ fontSize: 12.5, color: "var(--faint)" }}>기록 정정</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
              {Object.values(PATROL_BY_KEY).map((st) => (
                <button key={st.key} onClick={() => change(edit.student_id, edit.seat_id, st.key)}
                  style={{
                    minHeight: 54, borderRadius: 12, cursor: "pointer",
                    border: `1.5px solid ${edit.state === st.key ? st.dot : "var(--line)"}`,
                    background: edit.state === st.key ? st.bg : "var(--bg)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: st.dot }} />{st.label}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{st.points > 0 ? `+${st.points}` : "0"}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => change(edit.student_id, edit.seat_id, null)} style={{ height: 48, flex: 1, color: "var(--danger)" }}>기록 지우기</button>
              <button className="btn" onClick={() => setEdit(null)} style={{ height: 48, flex: 1 }}>닫기</button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
