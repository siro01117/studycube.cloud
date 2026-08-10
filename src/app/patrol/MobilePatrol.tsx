"use client";

// 모바일 순찰 — 한 번에 한 방씩, 터치 팬/핀치줌, 바텀시트 상태 선택, 오프라인 큐.
// 페이지 스크롤 없는 100dvh 고정 셸 → 크롬 주소창 접힘/펼침 레이아웃 점프 없음.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import MobileNav from "../_shared/MobileNav";
import { PATROL_STATES, PATROL_BY_KEY } from "@/lib/patrol";
import { SW, SH, xyOf, boundsOf } from "@/lib/seatmap";
import { PatrolQueue, type QueueStatus } from "@/lib/patrol-queue";
import { startPatrol, endPatrol, recordPatrolBulk, clearPatrolMark, getPatrolSessionDetail } from "../m/seat/patrolActions";

export type MRoom = { id: string; name: string; floor: number };
export type MSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string; current_student_id: string | null };
export type MStudent = { id: string; name: string };

const ATT_COLOR: Record<"in" | "out", { bg: string; bd: string }> = {
  in: { bg: "rgba(18,184,134,.15)", bd: "rgba(18,184,134,.55)" },
  out: { bg: "rgba(120,130,150,.12)", bd: "rgba(120,130,150,.4)" },
};
const MIN_S = 0.5, MAX_S = 3;

// 경과 시간 — 자체 타이머(부모·좌석 리렌더 방지, FloorEditor PatrolElapsed 패턴)
function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const el = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hh = Math.floor(el / 3600), mm = Math.floor((el % 3600) / 60), ss = el % 60;
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{(hh > 0 ? hh + ":" : "") + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0")}</span>;
}

export default function MobilePatrol({ rooms, seats, students, attendance, canManage, branchKey }: {
  rooms: MRoom[]; seats: MSeat[]; students: MStudent[];
  attendance: Record<string, "in" | "out">; canManage: boolean; branchKey: string;
}) {
  const [roomIdx, setRoomIdx] = useState(0);
  const [view, setView] = useState({ tx: 12, ty: 12, s: 1 });
  const [marks, setMarks] = useState<Record<string, string>>({});         // studentId → state
  const [session, setSession] = useState<{ sessionId: string; startedAt: number } | null>(null);
  const [sheet, setSheet] = useState<MSeat | null>(null);                  // 상태 선택 시트
  const [confirm, setConfirm] = useState<"start" | "end" | "next" | null>(null);
  const [qs, setQs] = useState<QueueStatus>({ pending: 0, sending: false, error: false, ids: [] });
  // 브라우저 온라인 여부는 외부 상태 — useSyncExternalStore 로 구독(SSR 은 온라인 가정)
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb); window.addEventListener("offline", cb);
      return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
    },
    () => navigator.onLine,
    () => true,
  );
  const [toast, setToast] = useState<string | null>(null);

  const queueRef = useRef<PatrolQueue | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const nameOf = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);
  const seatsByRoom = useMemo(() => {
    const m = new Map<string, MSeat[]>();
    for (const s of seats) { if (!s.room_id) continue; (m.get(s.room_id) ?? m.set(s.room_id, []).get(s.room_id)!).push(s); }
    return m;
  }, [seats]);
  const room = rooms[roomIdx] ?? null;
  // 참조가 매 렌더 바뀌면 fitRoom 이 다시 돌아 팬·줌이 초기화된다 → 메모 고정.
  const roomSeats = useMemo(() => (room ? seatsByRoom.get(room.id) ?? [] : []), [room, seatsByRoom]);
  const roomPts = useMemo(() => roomSeats.map((s, i) => xyOf(s, i)), [roomSeats]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  // ── 큐 초기화 + 세션 복원 (localStorage는 클라 전용 → 마운트 후) ──
  useEffect(() => {
    const q = new PatrolQueue(branchKey, { start: startPatrol, end: endPatrol, recordBulk: recordPatrolBulk, clear: clearPatrolMark });
    queueRef.current = q;
    const un = q.subscribe(setQs);
    q.attach();

    // 진행 중 세션 복원(탭 킬·화면잠금 대비): 서버 반영분 + 큐 잔여분 merge
    const sess = q.session;
    if (sess && !sess.endRequested) {
      setSession({ sessionId: sess.sessionId, startedAt: sess.startedAt });
      getPatrolSessionDetail(sess.sessionId)
        .then((rows) => {
          const m: Record<string, string> = {};
          for (const r of rows) m[r.student_id] = r.state;
          for (const [sid, qm] of Object.entries(q.queuedMarks)) {
            if (qm.state === null) delete m[sid]; else m[sid] = qm.state;
          }
          setMarks(m);
        })
        .catch(() => { // 오프라인 복원 — 큐 잔여분만이라도
          const m: Record<string, string> = {};
          for (const [sid, qm] of Object.entries(q.queuedMarks)) if (qm.state) m[sid] = qm.state;
          setMarks(m);
        });
    }
    return () => { un(); q.detach(); };
  }, [branchKey]);

  // ── 방 전환 시 초기 배율 ──
  // 방 전체를 욱여넣지 않는다(좌석이 손가락보다 작아짐). 좌석을 누를 수 있는 크기(최소 1:1 = 82×60,
  // 터치 타깃 48dp 이상)로 두고, 넘치는 방은 팬해서 본다. 작은 방은 화면을 채우도록 살짝 키운다.
  const fitRoom = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const { w, h } = boundsOf(roomPts.length ? roomPts : []);
    const vw = el.clientWidth, vh = el.clientHeight;
    const pad = 10;
    const cover = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
    const s = Math.min(Math.max(cover, 1), 1.5); // 안 들어가면 1:1 유지(팬), 남으면 최대 1.5배
    // 화면보다 작으면 가운데, 크면 좌상단에서 시작
    setView({ tx: Math.max(pad, (vw - w * s) / 2), ty: Math.max(pad, (vh - h * s) / 2), s });
  }, [roomPts]);
  useEffect(() => { fitRoom(); }, [roomIdx, fitRoom]);

  // ── 제스처 (팬 / 핀치 / 탭) ──
  const gesture = useRef<{
    pts: Map<number, { x: number; y: number }>;
    prevMid: { x: number; y: number } | null; prevDist: number | null;
    downAt: number; downPos: { x: number; y: number } | null; moved: boolean; multi: boolean;
  }>({ pts: new Map(), prevMid: null, prevDist: null, downAt: 0, downPos: null, moved: false, multi: false });

  // 캔버스 위 버튼·링크는 제스처 대상 아님 — 안 걸러내면 setPointerCapture 가 포인터를 가져가 클릭이 안 먹는다.
  const onControl = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest?.("button, a, input, select");

  const onPointerDown = (e: React.PointerEvent) => {
    if (onControl(e)) return;
    const g = gesture.current;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pts.size === 1) { g.downAt = Date.now(); g.downPos = { x: e.clientX, y: e.clientY }; g.moved = false; g.multi = false; }
    else { g.multi = true; g.prevDist = null; g.prevMid = null; }
    // 합성 이벤트·마우스에선 활성 포인터가 없어 예외가 난다 → 캡처는 실패해도 무시
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.pts.has(e.pointerId)) return;
    const prev = g.pts.get(e.pointerId)!;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pts.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (g.downPos && Math.hypot(e.clientX - g.downPos.x, e.clientY - g.downPos.y) > 8) g.moved = true;
      if (g.moved) setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (g.pts.size === 2) {
      const [a, b] = [...g.pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.prevDist != null && g.prevMid != null) {
        const pm = g.prevMid, pd = g.prevDist;
        setView((v) => {
          const s2 = Math.min(Math.max(v.s * (dist / pd), MIN_S), MAX_S);
          const k = s2 / v.s;
          // prevMid 기준 줌 → mid 이동만큼 팬
          const tx = pm.x - k * (pm.x - v.tx) + (mid.x - pm.x);
          const ty = pm.y - k * (pm.y - v.ty) + (mid.y - pm.y);
          return { tx, ty, s: s2 };
        });
      }
      g.prevMid = mid; g.prevDist = dist;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (onControl(e)) return;
    const g = gesture.current;
    const wasTap = g.pts.size === 1 && !g.moved && !g.multi && Date.now() - g.downAt < 400;
    g.pts.delete(e.pointerId);
    if (g.pts.size < 2) { g.prevMid = null; g.prevDist = null; }
    if (!wasTap) return;

    // 탭 → 좌석 히트테스트 (화면좌표 → 월드좌표 역산)
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const v = viewRef.current;
    const wx = (e.clientX - rect.left - v.tx) / v.s;
    const wy = (e.clientY - rect.top - v.ty) / v.s;
    for (let i = 0; i < roomSeats.length; i++) {
      const p = roomPts[i];
      if (wx >= p.x && wx <= p.x + SW && wy >= p.y && wy <= p.y + SH) {
        const seat = roomSeats[i];
        if (!seat.current_student_id) return;
        if (!canManage) return;
        if (!session) { say("먼저 순찰을 시작하세요"); return; }
        setSheet(seat);
        return;
      }
    }
  };

  // ── 마킹 ──
  const applyMark = (studentId: string, state: string | null) => {
    setMarks((m) => {
      const n = { ...m };
      if (state === null) delete n[studentId]; else n[studentId] = state;
      return n;
    });
    queueRef.current?.mark(studentId, state);
    setSheet(null);
  };

  const queuedIds = useMemo(() => new Set(qs.ids), [qs.ids]);
  const tally = useMemo(() => Object.values(marks).reduce((a, k) => a + (PATROL_BY_KEY[k]?.points ?? 0), 0), [marks]);
  const roomMarked = roomSeats.filter((s) => s.current_student_id && marks[s.current_student_id]).length;
  const roomAssigned = roomSeats.filter((s) => s.current_student_id).length;

  // 배정된 학생이 있는데 이번 세션에서 마크가 없는 좌석 — 좌석번호 오름차순.
  // 오프라인 큐 대기분은 이미 marks 에 즉시 반영되므로(applyMark) 별도 처리 불필요.
  const uncheckedOf = useCallback((list: MSeat[]) => list
    .filter((s) => s.current_student_id && !marks[s.current_student_id])
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
  [marks]);
  const uncheckedRoom = useMemo(() => (session ? uncheckedOf(roomSeats) : []), [session, roomSeats, uncheckedOf]);
  const uncheckedAll = useMemo(() => (session ? uncheckedOf(seats.filter((s) => s.room_id)) : []), [session, seats, uncheckedOf]);

  const doStart = () => {
    const id = crypto.randomUUID();
    queueRef.current?.startSession(id);
    setSession({ sessionId: id, startedAt: Date.now() });
    setMarks({});
    setConfirm(null);
  };
  const doEnd = () => {
    queueRef.current?.endSession();
    setSession(null);
    setConfirm(null);
    say("순찰 종료됨");
  };
  const goNext = () => setRoomIdx((i) => Math.min(rooms.length - 1, i + 1));
  const handleNext = () => {
    if (uncheckedRoom.length > 0) { setConfirm("next"); return; }
    goNext();
  };

  // ── 동기화 칩 상태 ──
  const sync = qs.pending > 0
    ? { label: online ? `${qs.pending}건 대기` : `오프라인 · ${qs.pending}`, color: qs.error && online ? "var(--danger)" : "var(--warn)" }
    : { label: "동기화됨", color: "var(--ok)" };

  const sheetStudent = sheet?.current_student_id ? nameOf.get(sheet.current_student_id) : null;
  const sheetMark = sheet?.current_student_id ? marks[sheet.current_student_id] : undefined;

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)", touchAction: "none" }}>
      {/* ── 상단바: 현재 방 타이틀 중앙 (방 전환은 하단 ‹›) ── */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <MobileNav current="/patrol" />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{room ? `${room.floor}층 ${room.name}` : "방 없음"}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
            방 {roomIdx + 1}/{rooms.length}
          </div>
        </div>
        <button onClick={() => queueRef.current?.flush()} className="chip" style={{ height: 32, flex: "none", color: sync.color, fontWeight: 700 }}>
          {qs.sending ? "전송중…" : sync.label}
        </button>
      </div>

      {/* ── 방 캔버스 ── */}
      <div ref={canvasRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none", cursor: "grab" }}>
        {room && (
          <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: "0 0" }}>
            {roomSeats.map((s, i) => {
              const p = roomPts[i];
              const sid = s.current_student_id;
              const mk = sid ? marks[sid] : undefined;
              const preset = mk ? PATROL_BY_KEY[mk] : undefined;
              const att = sid ? attendance[sid] : undefined;
              const fill = preset ? { bg: preset.bg, bd: preset.bd }
                : att ? ATT_COLOR[att]
                : sid ? { bg: "var(--card)", bd: "var(--line)" }
                : { bg: "var(--panel2)", bd: "var(--line)" };
              const queued = sid ? queuedIds.has(sid) : false;
              return (
                <div key={s.id} style={{
                  position: "absolute", left: p.x, top: p.y, width: SW, height: SH,
                  background: fill.bg, border: `1.5px solid ${fill.bd}`, borderRadius: 10,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  opacity: sid ? 1 : 0.55,
                }}>
                  {/* 번호는 상단 띠에 고정 — 이름과 겹치지 않게 영역을 분리한다 */}
                  <span style={{ position: "absolute", top: 2, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--faint)", letterSpacing: ".02em" }}>{s.number ?? s.label}</span>
                  {sid ? (
                    <div style={{ marginTop: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: "100%" }}>
                      {/* 이름은 식별용 — 순찰에서 눈에 들어와야 하는 건 '상태'라 이름은 한 단계 낮춘다 */}
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: preset ? "var(--sub)" : "var(--ink)", lineHeight: 1.15, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf.get(sid)}</span>
                      {/* 상태는 찍힌 것만 — '미점검'을 매 좌석에 쓰면 시야만 어지럽다 */}
                      {preset && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 800, color: preset.dot, lineHeight: 1.1 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.dot }} />{preset.label}
                        </span>
                      )}
                    </div>
                  ) : <span style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>공석</span>}
                  {queued && <span title="전송 대기" style={{ position: "absolute", bottom: 4, right: 5, width: 7, height: 7, borderRadius: "50%", background: "var(--warn)" }} />}
                </div>
              );
            })}
          </div>
        )}
        {room && (
          <>
            <div style={{ position: "absolute", top: 8, left: 10, fontSize: 12, fontWeight: 800, color: "var(--sub)", background: "color-mix(in srgb, var(--bg) 80%, transparent)", borderRadius: 8, padding: "4px 9px", pointerEvents: "none" }}>
              {roomMarked}/{roomAssigned} 점검
            </div>
          </>
        )}
      </div>

      {/* ── 하단바: 엄지 존. 방 이동 + 순찰 시작/종료 ──
           찍은 학생만 기록한다(미표시 학생을 자동 입석 처리하지 않는다 — 실제로 확인 안 한 걸 기록에 남기지 않기 위해). */}
      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "var(--card)", borderTop: "1px solid var(--line)" }}>
        {session && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--dim)", padding: "0 2px" }}>
            <span><Elapsed startedAt={session.startedAt} /> 경과 · 벌점 <b style={{ color: tally ? "var(--danger)" : "var(--sub)" }}>{tally}점</b></span>
            <button onClick={() => setConfirm("end")} style={{ border: "none", background: "transparent", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>순찰 종료</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button className="btn" disabled={roomIdx === 0} onClick={() => setRoomIdx((i) => Math.max(0, i - 1))} style={{ height: 56, flex: "0 0 60px", fontSize: 20 }} aria-label="이전 방">‹</button>
          {!session ? (
            <button className="btn btn-accent" disabled={!canManage} onClick={() => setConfirm("start")} style={{ height: 56, flex: 1, fontSize: 16, fontWeight: 800 }}>순찰 시작</button>
          ) : (
            <button className="btn" onClick={() => setConfirm("end")} style={{ height: 56, flex: 1, background: "var(--ink)", borderColor: "var(--ink)", color: "#fff", display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.2 }}>
              <span style={{ fontSize: 15.5, fontWeight: 800 }}>순찰 종료</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{roomMarked}/{roomAssigned} 이 방 · 총 {Object.keys(marks).length}명 기록</span>
            </button>
          )}
          <button className="btn" disabled={roomIdx >= rooms.length - 1} onClick={handleNext} style={{ height: 56, flex: "0 0 60px", fontSize: 20 }} aria-label="다음 방">›</button>
        </div>
      </div>

      {/* ── 상태 선택 바텀시트 ── */}
      {sheet && sheetStudent && (
        <>
          <div onClick={() => setSheet(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.4)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "16px 16px calc(16px + env(safe-area-inset-bottom))", boxShadow: "0 -8px 30px rgba(10,12,18,.18)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>{sheetStudent}</span>
              <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{sheet.number ?? sheet.label}번</span>
              {sheetMark && <span style={{ fontSize: 12, fontWeight: 700, color: PATROL_BY_KEY[sheetMark]?.dot }}>현재: {PATROL_BY_KEY[sheetMark]?.label}</span>}
            </div>
            {(["재석", "이석"] as const).map((grp) => {
              const list = PATROL_STATES.filter((st) => st.present === (grp === "재석"));
              return (
                <div key={grp} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--faint)", marginBottom: 6 }}>{grp === "재석" ? "자리에 있음" : "자리 비움"}</div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(list.length, 4)}, 1fr)`, gap: 8 }}>
                    {list.map((st) => (
                      <button key={st.key} onClick={() => applyMark(sheet.current_student_id!, st.key)}
                        style={{
                          minHeight: 52, borderRadius: 12, cursor: "pointer",
                          border: `1.5px solid ${sheetMark === st.key ? st.dot : "var(--line)"}`,
                          background: sheetMark === st.key ? st.bg : "var(--panel2)",
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                        }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: st.dot }} />{st.label}
                        </span>
                        <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{st.points > 0 ? `벌점 ${st.points}` : "벌점 없음"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {sheetMark && (
                <button className="btn" onClick={() => applyMark(sheet.current_student_id!, null)} style={{ height: 46, flex: 1, color: "var(--danger)" }}>기록 지우기</button>
              )}
              <button className="btn" onClick={() => setSheet(null)} style={{ height: 46, flex: 1 }}>닫기</button>
            </div>
          </div>
        </>
      )}

      {/* ── 시작/종료/다음방 확인 시트 ── */}
      {confirm && (() => {
        const unchecked = confirm === "next" ? uncheckedRoom : confirm === "end" ? uncheckedAll : [];
        const hasWarn = unchecked.length > 0;
        const shown = unchecked.slice(0, 12).map((s) => `${s.number ?? s.label}번 ${nameOf.get(s.current_student_id!) ?? ""}`);
        const rest = unchecked.length - shown.length;
        const proceed = confirm === "start" ? doStart : confirm === "next" ? goNext : doEnd;
        const title = confirm === "start" ? "순찰을 시작할까요?"
          : hasWarn ? `미점검 ${unchecked.length}명`
          : confirm === "next" ? "다음 방으로 이동할까요?" : "순찰을 종료할까요?";
        return (
          <>
            <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.4)", zIndex: 40 }} />
            <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))" }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{title}</div>
              {hasWarn ? (
                <div style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 12, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, color: "var(--ink)", lineHeight: 1.6 }}>
                  {shown.join(", ")}{rest > 0 ? ` 외 ${rest}명` : ""}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--dim)", marginBottom: 14 }}>
                  {confirm === "start"
                    ? "시작 후 좌석을 탭해 상태를 기록합니다. 통신이 끊겨도 기록은 저장되고 자동 전송됩니다."
                    : confirm === "next"
                    ? "이 방은 전원 점검되었습니다."
                    : `점검 ${Object.keys(marks).length}명 · 누적 벌점 ${tally}점${qs.pending > 0 ? ` · 미전송 ${qs.pending}건은 연결되면 자동 전송` : ""}`}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className={hasWarn ? "btn btn-accent" : "btn"} onClick={() => setConfirm(null)} style={{ height: 48, flex: 1, fontWeight: hasWarn ? 800 : 400 }}>{hasWarn ? "돌아가서 확인" : "취소"}</button>
                <button className={hasWarn ? "btn" : "btn btn-accent"} onClick={proceed} style={{ height: 48, flex: 1, fontWeight: 800 }}>
                  {hasWarn ? "그대로 진행" : confirm === "start" ? "시작" : confirm === "next" ? "이동" : "종료"}
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(90px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 50, background: "var(--ink)", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 999, padding: "9px 16px", whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}
    </main>
  );
}
