"use client";

// 모바일 순찰 — 한 번에 한 방씩, 터치 팬/핀치줌, 바텀시트 상태 선택, 오프라인 큐.
// 페이지 스크롤 없는 100dvh 고정 셸 → 크롬 주소창 접힘/펼침 레이아웃 점프 없음.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import MobileNav from "../_shared/MobileNav";
import { PATROL_STATES, PATROL_BY_KEY } from "@/lib/patrol";
import { SW, SH, xyOf, boundsOf } from "@/lib/seatmap";
import { PatrolQueue, type QueueStatus } from "@/lib/patrol-queue";
import { startPatrol, endPatrol, recordPatrolBulk, clearPatrolMark, getPatrolSessionDetail } from "../m/seat/patrolActions";
import { statusAt, upcomingAt, ghostStyleOf, reasonColor, isPatrolExempt, type DaySlot } from "@/lib/schedule";

export type MRoom = { id: string; name: string; floor: number };
export type MSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string; current_student_id: string | null };
export type MStudent = { id: string; name: string };
// 오늘 요일 기준 학생별 스케쥴 파생 정보(page.tsx 에서 branch 전체를 3개 쿼리로 읽어 memory join).
// hours 도 slots 도 없으면(=이 학생은 스케쥴 정보가 아예 없음) state:"none"("미설정") 회색 고스트를 그린다
// (모르는 것과 그냥 등원전인 것을 구분하기 위함 — ghostOf 참고).
export type MScheduleInfo = { hours: { arrive_min: number; leave_min: number } | null; slots: DaySlot[] };
export type MOpenSession = {
  sessionId: string;
  startedByName: string;
  markedCount: number;
  dayLabel: string;
  timeLabel: string;
  lastLabel: string | null;
};

// 이 화면은 항상 "순찰 모드"다(별도의 평소 배치도 뷰가 없다) — 출결(입/하원) 색은 마크 없는 좌석에
// 더 이상 쓰지 않는다(고스트 색과 섞여 판단을 방해했다). 실제 마크(preset) > 고스트 > 기본 좌석 색.
const MIN_S = 0.5, MAX_S = 3;
// 임박 일정 미리 알림 — 이 분 이내에 시작하는 일정만 보조 라벨로 보여준다.
const UPCOMING_WITHIN_MIN = 60;
const UPCOMING_SOON_MIN = 10; // 이 이하로 남으면 강조(warn) 색
// 좌석이 이 높이 미만이면 이름+상태 두 줄도 빠듯해 보조 라벨(세 번째 줄)은 title 로만 남긴다.
const MIN_SEAT_H_FOR_SUBLABEL = 60;
// 좌석 테두리 두께·라운드 — 고스트 좌측 스트립을 테두리 안쪽으로 들일 때도 이 값을 참조한다(하드코딩 금지).
const SEAT_BORDER_W = 1.5;
const SEAT_RADIUS = 10;

// KST 기준 분(minute-of-day) 계산 — new Date() 호출은 반드시 useEffect/이벤트 핸들러 안에서만 이 함수를 통해.
function kstNowMin(): number {
  const d = new Date();
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 540) % 1440;
}
// nowMin(분) → "HH:MM" — 순수 포맷팅, Date 미사용.
function fmtHM(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// scheduled 상태 예상 표시 색 · 배경/스트립/흐림 계산은 src/lib/schedule.ts 의 REASON_SEMANTIC/ghostStyleOf/reasonColor
// (데스크탑 FloorEditor.tsx 와 공용 — 계산이 갈리지 않도록 여기서 재정의하지 않는다).

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

export default function MobilePatrol({ rooms, seats, students, attendance, canManage, branchKey, openSession, scheduleMap }: {
  rooms: MRoom[]; seats: MSeat[]; students: MStudent[];
  attendance: Record<string, "in" | "out">; canManage: boolean; branchKey: string;
  openSession: MOpenSession | null;
  scheduleMap: Record<string, MScheduleInfo>;
}) {
  const [roomIdx, setRoomIdx] = useState(0);
  const [view, setView] = useState({ tx: 12, ty: 12, s: 1 });
  const [marks, setMarks] = useState<Record<string, string>>({});         // studentId → state
  const [session, setSession] = useState<{ sessionId: string; startedAt: number } | null>(null);
  const [sheet, setSheet] = useState<MSeat | null>(null);                  // 상태 선택 시트
  const [confirm, setConfirm] = useState<"start" | "end" | "next" | "resume" | null>(null);
  // 서버가 감지한 미종료 세션("이어하기" 대상). 로컬에서 이미 그 세션을 복원/종료했으면 비운다.
  const [resume, setResume] = useState<MOpenSession | null>(openSession);
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
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  // ── 예상 상태(고스트) 기준 시각: 현재 KST 분(minute-of-day). 초기 렌더는 null(하이드레이션 안전).
  // 순찰 중 라벨이 바뀌면 헷갈리므로 인터벌로 계속 갱신하지 않고, 마운트/순찰 시작·이어받기/수동 갱신
  // 시점에만 새로 계산해 고정한다. ──
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => { setNowMin(kstNowMin()); }, []);
  const refreshNowMin = () => {
    setNowMin(kstNowMin());
    say("기준 시각 갱신됨");
  };

  // 학생별 예상 상태 — 스케쥴 정보(hours/slots)가 아예 없으면 state:"none"("미설정")으로 표시(away 와 구분).
  // 자정 넘김 대비: 새벽 시간대(0~5시)는 오늘 분(minute) 과 +1440 좌표계 둘 다로 판정해 away 아닌 쪽을 채택.
  const ghostOf = useMemo(() => {
    const m = new Map<string, { state: "scheduled" | "study" | "away" | "none"; label: string; slot?: DaySlot }>();
    if (nowMin == null) return m;
    for (const [sid, info] of Object.entries(scheduleMap)) {
      // 등하원·오늘 일정 둘 다 없으면 "모르는 것"(none/미설정) — away(등원전/하원)와 구분해 회색으로 표시한다.
      if (!info.hours && info.slots.length === 0) { m.set(sid, { state: "none", label: "미설정" }); continue; }
      let result = statusAt(nowMin, info.hours, info.slots);
      if (result.state === "away" && nowMin < 300) {
        const alt = statusAt(nowMin + 1440, info.hours, info.slots);
        if (alt.state !== "away") result = alt;
      }
      m.set(sid, result);
    }
    return m;
  }, [scheduleMap, nowMin]);

  // 학생별 임박 일정 — 기준 시각으로부터 UPCOMING_WITHIN_MIN 분 이내에 시작하는 다음 일정.
  // 체크 여부와 무관하게 전 학생분을 미리 계산해두고, 실제 표시는 렌더에서 미체크 좌석만 걸러 쓴다.
  const upcomingOf = useMemo(() => {
    const m = new Map<string, { inMin: number; slot: DaySlot }>();
    if (nowMin == null) return m;
    for (const [sid, info] of Object.entries(scheduleMap)) {
      if (info.slots.length === 0) continue;
      const up = upcomingAt(nowMin, info.slots, UPCOMING_WITHIN_MIN);
      if (up) m.set(sid, up);
    }
    return m;
  }, [scheduleMap, nowMin]);

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
      setResume(null); // 이미 이 기기가 그 세션을 진행 중 — "이어하기" 표시 불필요
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
    } else if (sess?.endRequested && sess.sessionId === openSession?.sessionId) {
      // 이 기기가 이미 그 세션의 종료를 요청해둔 상태(오프라인 등으로 미전송) — 곧 자동 flush 로 정리되니
      // "이어하기"를 띄우지 않는다.
      setResume(null);
    }
    return () => { un(); q.detach(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // 미점검 집계 제외 대상(고스트 none/away) — 배정은 됐지만 확인이 필요 없는 학생. 탭 자체는 막지 않는다
  // (찍으면 marks 에 들어가 roomMarked 분자에는 그대로 잡힌다).
  const isExempt = useCallback((sid: string) => isPatrolExempt(ghostOf.get(sid)?.state), [ghostOf]);
  const roomMarked = roomSeats.filter((s) => s.current_student_id && marks[s.current_student_id]).length;
  const roomExempt = useMemo(
    () => roomSeats.filter((s) => s.current_student_id && isExempt(s.current_student_id)).length,
    [roomSeats, isExempt],
  );
  const roomAssigned = roomSeats.filter((s) => s.current_student_id).length - roomExempt;

  // 이 방의 "예상 재실/미등원" 요약 — 스케쥴 정보가 있는 배정 학생만 집계(실제 체크 여부와 무관하게 예상치).
  const roomExpected = useMemo(() => {
    if (nowMin == null) return null;
    let present = 0, away = 0, unset = 0;
    for (const s of roomSeats) {
      const sid = s.current_student_id;
      const g = sid ? ghostOf.get(sid) : undefined;
      if (!g) continue;
      if (g.state === "away") away++;
      else if (g.state === "none") unset++;
      else present++;
    }
    return { present, away, unset };
  }, [nowMin, roomSeats, ghostOf]);

  // 이 방에서 곧(UPCOMING_SOON_MIN 분 이내) 일정이 시작해 이동해야 하는, 아직 미체크인 학생 수.
  const roomSoon = useMemo(() => {
    if (nowMin == null) return 0;
    let n = 0;
    for (const s of roomSeats) {
      const sid = s.current_student_id;
      if (!sid || marks[sid]) continue;
      const up = upcomingOf.get(sid);
      if (up && up.inMin <= UPCOMING_SOON_MIN) n++;
    }
    return n;
  }, [nowMin, roomSeats, marks, upcomingOf]);

  // 배정된 학생이 있는데 이번 세션에서 마크가 없는 좌석 — 좌석번호 오름차순.
  // 오프라인 큐 대기분은 이미 marks 에 즉시 반영되므로(applyMark) 별도 처리 불필요.
  // 미점검 집계 제외 대상(고스트 none/away)은 경고에서도 뺀다.
  const uncheckedOf = useCallback((list: MSeat[]) => list
    .filter((s) => s.current_student_id && !marks[s.current_student_id] && !isExempt(s.current_student_id))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
  [marks, isExempt]);
  const uncheckedRoom = useMemo(() => (session ? uncheckedOf(roomSeats) : []), [session, roomSeats, uncheckedOf]);
  const uncheckedAll = useMemo(() => (session ? uncheckedOf(seats.filter((s) => s.room_id)) : []), [session, seats, uncheckedOf]);

  const doStart = () => {
    const id = crypto.randomUUID();
    queueRef.current?.startSession(id);
    setSession({ sessionId: id, startedAt: Date.now() });
    setMarks({});
    setConfirm(null);
    setResume(null);
    setNowMin(kstNowMin()); // 순찰 시작 시점 기준으로 고스트 기준 시각을 다시 고정
  };
  const doEnd = () => {
    queueRef.current?.endSession();
    setSession(null);
    setConfirm(null);
    setResume(null);
    say("순찰 종료됨");
  };

  // 큐가 다른(대상과 다른) 세션을 아직 들고 있으면 먼저 흘려보낸다 — 이어하기/새로시작이
  // 그 세션의 잔여 마킹을 덮어쓰거나 유실시키지 않도록. 활성(미종료요청) 세션이면 flush 로는
  // 안 비워지므로 그때는 진행하지 않고 사용자에게 알린다.
  const clearForeignQueue = async (targetId: string): Promise<boolean> => {
    const q = queueRef.current;
    if (!q || !q.session || q.session.sessionId === targetId) return true;
    say("이전 순찰 기록을 먼저 전송하는 중…");
    await q.flush();
    if (q.session) { say("이전 기록 전송 실패 — 연결을 확인한 뒤 다시 시도하세요"); return false; }
    return true;
  };

  // 이어하기 — 새 세션을 만들지 않고 기존 세션 id 로 진입, 기존 마크를 불러와 복원한다.
  const doResume = async () => {
    if (!resume) return;
    const target = resume.sessionId;
    if (!(await clearForeignQueue(target))) return;
    queueRef.current?.startSession(target); // id 는 이미 DB에 있음(on conflict do nothing) — 새 세션 아님
    setSession({ sessionId: target, startedAt: Date.now() });
    setConfirm(null);
    setResume(null);
    setNowMin(kstNowMin()); // 이어받는 시점 기준으로 고스트 기준 시각을 다시 고정
    try {
      const rows = await getPatrolSessionDetail(target);
      const m: Record<string, string> = {};
      for (const r of rows) m[r.student_id] = r.state;
      setMarks(m);
    } catch {
      say("기존 기록 불러오기 실패 — 새로고침 후 다시 시도하세요");
    }
  };

  // 새로 시작 — 미종료 세션을 종료 처리한 뒤 새 세션을 시작(미종료 세션이 쌓이지 않게).
  const doFresh = async () => {
    if (!resume) return;
    const target = resume.sessionId;
    if (!(await clearForeignQueue(target))) return;
    try {
      const f = new FormData();
      f.set("sessionId", target);
      await endPatrol(f);
    } catch {
      say("기존 세션 종료 실패 — 다시 시도하세요");
      return;
    }
    setResume(null);
    doStart();
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
        <button
          onClick={refreshNowMin}
          title="지금 시각으로 갱신"
          style={{ flex: "none", background: "transparent", border: "none", padding: "2px 4px", fontSize: 11.5, color: "var(--dim)", cursor: "pointer", fontVariantNumeric: "tabular-nums" }}
        >
          기준 {nowMin != null ? fmtHM(nowMin) : "--:--"}
        </button>
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
              // 예상 상태(고스트) — 아직 체크 안 된(mk 없는) 좌석에만. 채움색(fill)에는 절대 관여하지 않는다(축 분리).
              const ghost = sid && !mk ? ghostOf.get(sid) : undefined;
              // 임박 일정 보조 라벨 — 역시 미체크 좌석에만. 좌석이 좁으면(세 줄이 안 들어가면) 시각 표시는 생략하고 title 로만.
              const upcoming = sid && !mk ? upcomingOf.get(sid) : undefined;
              const upcomingText = upcoming ? `${upcoming.inMin}분 뒤 ${upcoming.slot.reason}` : undefined;
              const showUpcomingLabel = !!upcoming && SH >= MIN_SEAT_H_FOR_SUBLABEL;
              // 라벨 색(흐리게 쓸 기본 색)과 좌측 스트립 색·배경 틴트·흐림은 데스크탑과 같은 계산(ghostStyleOf)을 쓴다
              // — 두 화면이 같은 규칙으로 보이도록. 테두리(fill.bd)는 고스트가 건드리지 않는다.
              let ghostLabelColor: string | undefined;
              const gs = ghost ? ghostStyleOf(ghost.state, ghost.label) : null;
              if (ghost) {
                ghostLabelColor = ghost.state === "away" || ghost.state === "none" ? "var(--faint)" : reasonColor(ghost.label);
              }
              // 이 화면은 항상 순찰 모드다 — 마크(preset) 없는 좌석엔 출결 색을 쓰지 않고 고스트 스타일만 쓴다.
              const fill = preset ? { bg: preset.bg, bd: preset.bd }
                : sid ? { bg: "var(--card)", bd: "var(--line)" }
                : { bg: "var(--panel2)", bd: "var(--line)" };
              const bgColor = gs ? gs.bg : fill.bg;
              const dim = !sid ? 0.55 : gs ? gs.dim : 1;
              const queued = sid ? queuedIds.has(sid) : false;
              return (
                <div key={s.id} style={{
                  position: "absolute", left: p.x, top: p.y, width: SW, height: SH,
                  backgroundColor: bgColor,
                  // 예상 상태 좌측 스트립은 별도 요소 대신 배경의 linear-gradient 로 그린다 — background 는
                  // border-box 안쪽에 클리핑되고 border 가 그 위에 그려지므로 모서리 밖으로 새지 않는다.
                  // away 는 색 없음(위 opacity 로만 구분), study/scheduled 만 스트립이 있다.
                  backgroundImage: gs?.strip ? `linear-gradient(to right, ${gs.strip} 0 3px, transparent 3px)` : undefined,
                  borderWidth: SEAT_BORDER_W, borderStyle: "solid", borderColor: fill.bd, borderRadius: SEAT_RADIUS,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  opacity: dim,
                }}
                title={upcomingText && !showUpcomingLabel ? upcomingText : undefined}>
                  {/* 번호는 상단 띠에 고정 — 이름과 겹치지 않게 영역을 분리한다 */}
                  <span style={{ position: "absolute", top: 2, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--faint)", letterSpacing: ".02em" }}>{s.number ?? s.label}</span>
                  {sid ? (
                    <div style={{ marginTop: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: "100%" }}>
                      {/* 이름은 식별용 — 순찰에서 눈에 들어와야 하는 건 '상태'라 이름은 한 단계 낮춘다 */}
                      <span style={{ fontSize: 12, fontWeight: 600, color: preset ? "var(--sub)" : "var(--ink)", lineHeight: 1.15, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf.get(sid)}</span>
                      {/* 상태는 찍힌 것만(실제) 우선, 없으면 예상(고스트, 흐리게) — '미점검'을 매 좌석에 쓰면 시야만 어지럽다 */}
                      {preset ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 800, color: preset.dot, lineHeight: 1.1 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.dot }} />{preset.label}
                        </span>
                      ) : ghost ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 800, color: ghostLabelColor, opacity: 0.48, lineHeight: 1.1 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: ghostLabelColor }} />{ghost.label}
                        </span>
                      ) : null}
                      {/* 임박 일정 보조 라벨 — 현재 상태 고스트보다 한 단계 더 작고 흐리게, 10분 이하면 warn 강조 */}
                      {showUpcomingLabel && upcoming && (
                        <span
                          title={upcomingText}
                          style={{
                            fontSize: 10, fontWeight: upcoming.inMin <= UPCOMING_SOON_MIN ? 700 : 400,
                            color: upcoming.inMin <= UPCOMING_SOON_MIN ? "var(--warn)" : "var(--dim)",
                            lineHeight: 1.1, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {upcoming.inMin}분 뒤 {upcoming.slot.reason}
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
              {roomExempt > 0 && <span style={{ color: "var(--faint)", fontWeight: 700 }}> · 제외 {roomExempt}명</span>}
              {roomExpected && (
                <>
                  {" · "}예상 재실 {roomExpected.present}명
                  {roomExpected.away > 0 && <span style={{ color: "var(--faint)", fontWeight: 700 }}> · 등원전 {roomExpected.away}명</span>}
                  {roomExpected.unset > 0 && <span style={{ color: "var(--faint)", fontWeight: 700 }}> · 미설정 {roomExpected.unset}명</span>}
                  {roomSoon > 0 && <span style={{ color: "var(--warn)", fontWeight: 700 }}> · 곧 이동 {roomSoon}명</span>}
                </>
              )}
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
          {!session && resume ? (
            <button className="btn btn-accent" disabled={!canManage} onClick={() => setConfirm("resume")} style={{ height: 56, flex: 1, fontSize: 16, fontWeight: 800 }}>이어하기</button>
          ) : !session ? (
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

      {/* ── 이어하기 확인 시트 (시작/종료/다음방과 버튼 구성이 달라 별도 분기) ── */}
      {confirm === "resume" && resume && (
        <>
          <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.4)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))" }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>하던 순찰을 이어할까요?</div>
            <div style={{ fontSize: 12.5, color: "var(--dim)", marginBottom: 14, lineHeight: 1.6 }}>
              {resume.dayLabel} {resume.timeLabel} 시작 · {resume.startedByName} · {resume.markedCount}명 점검
              {resume.lastLabel ? ` · 마지막 기록 ${resume.lastLabel}` : ""}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-accent" onClick={doResume} style={{ height: 48, fontWeight: 800 }}>이어하기</button>
              <button className="btn" onClick={doFresh} style={{ height: 48, color: "var(--danger)" }}>새로 시작 (기존 기록은 종료 처리)</button>
              <button className="btn" onClick={() => setConfirm(null)} style={{ height: 48 }}>취소</button>
            </div>
          </div>
        </>
      )}

      {/* ── 시작/종료/다음방 확인 시트 ── */}
      {confirm && confirm !== "resume" && (() => {
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
