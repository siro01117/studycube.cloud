"use client";

import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { DAYS, DayKey, CLASSROOM_ORDER } from "./constants";

// ── 레이아웃 상수 ─────────────────────────────────────────────
const BASE_HOUR    = 8;           // 08:00 기준
const TOTAL_HOURS  = 17;          // 08:00 ~ 01:00
const TIME_COL_W   = 52;
const MIN_BLOCK_H  = 16;
const FALLBACK_PPH = 56;          // SSR fallback

// 화면 높이에 맞춰 PX_PER_HOUR 동적 계산
// topOffset: 시간표 위쪽 차지 픽셀 (wide=탭행만, tall=헤더+탭행+여백)
function usePxPerHour(topOffset: number) {
  const [pph, setPph] = useState(FALLBACK_PPH);
  const calc = useCallback(() => {
    const available = window.innerHeight - topOffset;
    setPph(Math.max(28, Math.floor(available / TOTAL_HOURS)));
  }, [topOffset]);
  useLayoutEffect(() => {
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [calc]);
  return pph;
}

// ── 타입 ──────────────────────────────────────────────────────
interface Classroom { id: string; name: string; }

export interface ScheduleEntry {
  id:               string;
  classroom_id:     string;
  classroom_name?:  string;   // 교실 이름 (선생님 뷰에서 블록에 표시)
  day:              DayKey;
  start_time:       string;   // "HH:MM" or "HH:MM:SS"
  end_time:         string;
  course_id?:       string;
  course_name?:     string;
  course_subject?:  string;   // 과목 (블록에 표시)
  teacher_name?:    string;
  teacher_color?:   string;   // 교사 색 (accent용)
  course_accent?:   string;   // 수업 강조 색
  enrolled_names?:  string[]; // 수강 학생 이름
  notes?:           string;   // 상담 시 학생 이름 등 메모
  is_override?:     boolean;
}

export interface CellClickInfo {
  classroomId:   string;
  classroomName: string;
  day:           string;
  time:          string;
  scheduleId?:   string;
  courseId?:     string;
  courseName?:   string;
  teacherName?:  string;
  startTime?:    string;
  endTime?:      string;
  notes?:        string;
  isOverride?:   boolean;
}

interface Props {
  view:              "day" | "room" | "teacher";
  classrooms:        Classroom[];
  schedules:         ScheduleEntry[];
  selectedDay:       DayKey;
  selectedRoom:      string;
  selectedTeacher?:  string;
  onDayChange:       (d: DayKey) => void;
  onRoomChange:      (id: string) => void;
  onTeacherChange?:  (name: string) => void;
  onCellClick:       (info: CellClickInfo) => void;
  onViewChange:      (v: "day" | "room" | "teacher") => void;
  isWide?:           boolean;   // 사이드바 레이아웃 여부
}

// ── 다크모드 감지 ─────────────────────────────────────────────
function useDarkMode(): boolean {
  // 기본값 true: 서버/클라이언트 첫 렌더 일치 (hydration error 방지), useEffect에서 실제 값 적용
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// ── 현재 시간 위치 계산 ────────────────────────────────────────
function useCurrentTimePx(pxPerHour: number): number | null {
  const [px, setPx] = useState<number | null>(null);
  const pxPerMin = pxPerHour / 60;

  const calcPx = useCallback(() => {
    const now = new Date();
    let h = now.getHours();
    const m = now.getMinutes();
    const inRange = (h >= BASE_HOUR) || (h === 0) || (h === 1 && m === 0);
    if (!inRange) { setPx(null); return; }
    if (h < BASE_HOUR) h += 24;
    const minutesFromBase = (h - BASE_HOUR) * 60 + m;
    if (minutesFromBase > TOTAL_HOURS * 60) { setPx(null); return; }
    setPx(minutesFromBase * pxPerMin);
  }, [pxPerMin]);

  useEffect(() => {
    calcPx();
    const id = setInterval(calcPx, 30_000);
    return () => clearInterval(id);
  }, [calcPx]);

  return px;
}

// ── 현재 시간 인디케이터 ──────────────────────────────────────
function NowIndicator({ top }: { top: number }) {
  return (
    <div
      className="pointer-events-none"
      style={{
        position:   "absolute",
        top,
        left:       0,
        right:      0,
        height:     1,
        zIndex:     15,
        background: "var(--sc-green)",
        opacity:    0.7,
      }}
    />
  );
}

// ── 유틸 ──────────────────────────────────────────────────────
function toHHMM(t: string): string { return t.slice(0, 5); }

function timeToMinutesFromBase(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (h < BASE_HOUR) h += 24;  // 자정 이후 처리
  return (h - BASE_HOUR) * 60 + m;
}

function indexToHour(i: number): number { return (BASE_HOUR + i) % 24; }
function hhmm(h: number, m = 0) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── 색상 결정 ─────────────────────────────────────────────────
const FALLBACK_ACCENTS = [
  "#00e875","#5badff","#c084fc","#fb923c",
  "#fbbf24","#f472b6","#2dd4bf","#f87171",
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num   = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** 라이트 모드에서 형광/밝은 accent를 매트하게 어둡게 변환 */
function matteForLight(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * 0.52)}, ${Math.round(g * 0.52)}, ${Math.round(b * 0.52)})`;
}

function colorFor(entry: ScheduleEntry, isDark: boolean, view?: string) {
  const isConsulting = !entry.course_id && !!entry.notes;

  // 상담 블록: 항상 선생님 색 고정
  // 일반 블록: 선생님 뷰 → 수업 고유색, 그 외 → 선생님 색
  const accent = isConsulting
    ? (entry.teacher_color
        ?? (() => {
          const key  = entry.teacher_name ?? entry.id;
          const hash = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length];
        })())
    : view === "teacher"
    ? (entry.course_accent ?? entry.teacher_color
        ?? (() => {
          const key  = entry.course_name ?? entry.id;
          const hash = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length];
        })())
    : (entry.teacher_color ?? entry.course_accent
        ?? (() => {
          const key  = entry.teacher_name ?? entry.course_name ?? entry.id;
          const hash = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length];
        })());

  const [r, g, b] = hexToRgb(accent);

  if (isDark) {
    // 다크 모드: 확실히 색감 보이는 진한 tint (캐쥬얼 톤)
    // #00FF85 → rgb(15,104,62)  밝은 다크 그린
    // #5badff → rgb(47,76,104)  밝은 다크 블루
    // #fb923c → rgb(103,55,28)  따뜻한 다크 오렌지
    const bgR = Math.round(r * 0.35 + 15);
    const bgG = Math.round(g * 0.35 + 15);
    const bgB = Math.round(b * 0.35 + 17);
    return {
      bg:        `rgb(${bgR}, ${bgG}, ${bgB})`,
      border:    accent,
      text:      "#ffffff",
      textDim:   "rgba(255,255,255,0.92)",
      textMuted: "rgba(255,255,255,0.68)",
    };
  } else {
    // 라이트 모드: 확실히 색감 보이는 파스텔 (캐쥬얼 톤)
    // #00FF85 → rgb(175,252,215)  밝은 민트
    // #5badff → rgb(202,236,252)  밝은 스카이블루
    // #fb923c → rgb(250,218,187)  밝은 피치
    const bgR = Math.min(252, Math.round(r * 0.30 + 175));
    const bgG = Math.min(252, Math.round(g * 0.30 + 175));
    const bgB = Math.min(250, Math.round(b * 0.30 + 173));
    const matteAccent = matteForLight(accent);
    return {
      bg:        `rgb(${bgR}, ${bgG}, ${bgB})`,
      border:    matteAccent,
      text:      "#0d0d0d",
      textDim:   "rgba(15,15,15,0.82)",
      textMuted: "rgba(15,15,15,0.60)",
    };
  }
}

// ── 블록 컴포넌트 ─────────────────────────────────────────────
function ScheduleBlock({
  schedule,
  pxPerHour,
  isDark,
  view,
  onClick,
}: {
  schedule:  ScheduleEntry;
  pxPerHour: number;
  isDark:    boolean;
  view:      string;
  onClick:   () => void;
}) {
  const pxPerMin = pxPerHour / 60;
  const startMin = timeToMinutesFromBase(toHHMM(schedule.start_time));
  const endMin   = timeToMinutesFromBase(toHHMM(schedule.end_time));
  const top      = startMin * pxPerMin;
  const height   = Math.max((endMin - startMin) * pxPerMin, MIN_BLOCK_H);
  const color    = colorFor(schedule, isDark, view);
  const showName     = height > 18;
  const showTeacher  = height > 40;
  const showTime     = height > 30;
  const showStudents = height > 68;

  const isConsulting = !schedule.course_id && !!schedule.notes;
  const notesParts      = (schedule.notes ?? "").split("||");
  const studentNoteName = notesParts[0] ?? "";
  const teacherNoteName = notesParts[1] ?? "";
  const names = schedule.enrolled_names ?? [];

  return (
    <div
      className="sched-block"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position:     "absolute",
        top,
        height,
        left:         3,
        right:        3,
        background:   color.bg,
        borderLeft:   `3px solid ${color.border}`,
        borderRadius: 6,
        cursor:       "pointer",
        overflow:     "hidden",
        padding:      "4px 6px 4px 6px",
        userSelect:   "none",
        transition:   "filter 0.15s, transform 0.15s",
        zIndex:       2,
      }}
      onMouseEnter={(e) => {
        // 라이트 모드: 어둡게, 다크 모드: 밝게
        e.currentTarget.style.filter    = isDark ? "brightness(1.4)" : "brightness(0.88)";
        e.currentTarget.style.transform = "scaleX(1.015)";
        e.currentTarget.style.zIndex    = "10";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter    = "";
        e.currentTarget.style.transform = "";
        e.currentTarget.style.zIndex    = "2";
      }}
    >
      {/* 임시 뱃지 */}
      {schedule.is_override && (
        <div style={{
          position:     "absolute",
          top:          3,
          right:        4,
          fontSize:     8,
          fontWeight:   800,
          color:        "#000",
          background:   color.border,
          borderRadius: 3,
          padding:      "1px 4px",
          opacity:      0.9,
        }}>임시</div>
      )}

      {/* 과목 (없으면 수업명 fallback) — 13px */}
      {showName && (
        <p style={{
          fontSize:     13,
          fontWeight:   800,
          color:        color.text,
          marginTop:    0,
          lineHeight:   1.3,
          overflow:     "hidden",
          whiteSpace:   "nowrap",
          textOverflow: "ellipsis",
          paddingRight: schedule.is_override ? 24 : 0,
        }}>
          {isConsulting
            ? (view === "teacher"
                ? (studentNoteName || "상담")
                : (teacherNoteName ? `${teacherNoteName}T` : "상담"))
            : (schedule.course_subject ?? schedule.course_name ?? "수업")}
        </p>
      )}

      {/* 강사명 + 첫 학생 이름 (인라인 콤팩트) — 선생님 뷰에서는 선생님 이름 생략 */}
      {showTeacher && (
        <p style={{
          fontSize:     11,
          fontWeight:   800,
          color:        color.text,
          opacity:      0.93,
          marginTop:    5,
          overflow:     "hidden",
          whiteSpace:   "nowrap",
          textOverflow: "ellipsis",
        }}>
          {/* 선생님 이름 — 일반 수업 + day/room 뷰만 표시 (상담은 제목에 이미 있음) */}
          {view !== "teacher" && schedule.teacher_name && !isConsulting && (
            <span>{schedule.teacher_name} T{names.length > 0 && !showStudents ? "  " : ""}</span>
          )}
          {/* 학생 목록이 안 보이는 작은 블록에서는 첫 학생 이름만 인라인으로 */}
          {!showStudents && names.length > 0 && (
            <span style={{ fontSize: view === "teacher" ? 11 : 9, opacity: view === "teacher" ? 0.93 : 0.85 }}>
              {names[0]}{names.length > 1 ? "…" : ""}
            </span>
          )}
          {/* 상담 2행 — day/room: 학생이름 / teacher뷰: 생략(제목에 이미 있음) */}
          {!showStudents && isConsulting && view !== "teacher" && (
            <span style={{ fontSize: 9, opacity: 0.85 }}>
              {studentNoteName}
            </span>
          )}
        </p>
      )}

      {/* 수강 학생 이름 (크기 충분할 때만 전체 목록) */}
      {/* 선생님 뷰: 선생님 서식(11px, 0.93) / 그 외: 학생 서식(9px, 0.85) */}
      {showStudents && names.length > 0 && (
        <p style={{
          fontSize:     view === "teacher" ? 11 : 9,
          fontWeight:   800,
          color:        color.text,
          opacity:      view === "teacher" ? 0.93 : 0.85,
          marginTop:    5,
          overflow:     "hidden",
          whiteSpace:   "nowrap",
          textOverflow: "ellipsis",
          lineHeight:   1.4,
        }}>
          {names.slice(0, 4).join(" · ")}{names.length > 4 ? ` +${names.length - 4}` : ""}
        </p>
      )}
      {/* 상담 2행 (큰 블록) — day/room: 학생이름 / teacher뷰: 생략 */}
      {showStudents && isConsulting && view !== "teacher" && (
        <p style={{
          fontSize:     9,
          fontWeight:   800,
          color:        color.text,
          opacity:      0.85,
          marginTop:    5,
          overflow:     "hidden",
          whiteSpace:   "nowrap",
          textOverflow: "ellipsis",
        }}>
          {studentNoteName}
        </p>
      )}

      {/* 시간 — 하단 */}
      {showTime && (
        <div style={{
          position:     "absolute",
          bottom:       3,
          left:         6,
          right:        5,
          fontSize:     9.5,
          fontWeight:   600,
          color:        color.textMuted,
          whiteSpace:   "nowrap",
          overflow:     "hidden",
          textOverflow: "ellipsis",
        }}>
          {toHHMM(schedule.start_time)} ~ {toHHMM(schedule.end_time)}
        </div>
      )}
    </div>
  );
}

// ── 탭 버튼 ───────────────────────────────────────────────────
function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 rounded-lg text-sm font-bold transition-all duration-200"
      style={{
        background: active ? "var(--sc-green)"  : "var(--sc-raised)",
        color:      active ? "var(--sc-bg)"     : "var(--sc-dim)",
        border:     `1px solid ${active ? "var(--sc-green)" : "var(--sc-border)"}`,
        transform:  active ? "scale(1.04)" : "scale(1)",
      }}
    >
      {children}
    </button>
  );
}

// ── 오늘 요일키 ──────────────────────────────────────────────
const DAY_TO_KEY: Record<number, DayKey> = {
  1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 0: "sun",
};

// ── 메인 그리드 ───────────────────────────────────────────────
export default function ScheduleGrid({
  view, classrooms, schedules,
  selectedDay, selectedRoom, selectedTeacher,
  onDayChange, onRoomChange, onTeacherChange, onCellClick, onViewChange,
  isWide = false,
}: Props) {
  // wide: 탭행(52px) 만 제외, tall: 상단 헤더 전체 제외
  const pxPerHour   = usePxPerHour(isWide ? 60 : 300);
  const pxPerMin    = pxPerHour / 60;
  const TOTAL_HEIGHT = TOTAL_HOURS * pxPerHour;
  const HOUR_INDICES = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i);
  const nowPx       = useCurrentTimePx(pxPerHour);
  const isDark      = useDarkMode();
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);
  const todayKey    = DAY_TO_KEY[new Date().getDay()];

  const sortedRooms = [...classrooms].sort((a, b) => {
    const ai = CLASSROOM_ORDER.indexOf(a.name);
    const bi = CLASSROOM_ORDER.indexOf(b.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // 선생님 목록 (schedules 에서 유일한 이름 추출)
  const teachers = Array.from(new Set(
    schedules.map((s) => s.teacher_name).filter((n): n is string => Boolean(n))
  )).sort();
  const activeTeacher = selectedTeacher ?? teachers[0] ?? "";

  const cols: { id: string; label: string }[] =
    view === "day"
      ? sortedRooms.map((r) => ({ id: r.id, label: r.name }))
      : DAYS.map((d) => ({ id: d.key, label: d.label + "요일" }));

  function getBlocksForCol(colId: string): ScheduleEntry[] {
    if (view === "day") {
      return schedules.filter((s) => s.classroom_id === colId && s.day === selectedDay);
    } else if (view === "teacher") {
      return schedules.filter((s) => s.teacher_name === activeTeacher && s.day === (colId as DayKey));
    } else {
      const activeRoom = sortedRooms.find((r) => r.id === selectedRoom);
      return schedules.filter(
        (s) => s.classroom_id === (activeRoom?.id ?? "") && s.day === (colId as DayKey)
      );
    }
  }

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, colId: string) {
    if ((e.target as HTMLElement).closest(".sched-block")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesFromBase = Math.round(y / pxPerMin / 5) * 5;
    const clamped  = Math.min(Math.max(0, minutesFromBase), TOTAL_HOURS * 60 - 5);
    const totalMins = BASE_HOUR * 60 + clamped;
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    const clickedTime = hhmm(h, m);

    if (view === "day") {
      const room = sortedRooms.find((r) => r.id === colId);
      onCellClick({ classroomId: colId, classroomName: room?.name ?? "", day: selectedDay, time: clickedTime });
    } else if (view === "teacher") {
      // 선생님 뷰: 교실 없이 요일/시간만
      onCellClick({ classroomId: "", classroomName: "", day: colId as DayKey, time: clickedTime });
    } else {
      const activeRoom = sortedRooms.find((r) => r.id === selectedRoom);
      onCellClick({ classroomId: activeRoom?.id ?? "", classroomName: activeRoom?.name ?? "", day: colId as DayKey, time: clickedTime });
    }
  }

  function handleBlockClick(s: ScheduleEntry, colId: string) {
    const base = {
      scheduleId:  s.id,
      courseId:    s.course_id,
      courseName:  s.course_subject ?? s.course_name ?? (!s.course_id && s.notes ? "상담" : undefined),
      teacherName: s.teacher_name,
      startTime:   toHHMM(s.start_time),
      endTime:     toHHMM(s.end_time),
      time:        toHHMM(s.start_time),
      notes:       s.notes,
      isOverride:  s.is_override,
    };
    if (view === "day") {
      const room = sortedRooms.find((r) => r.id === colId);
      onCellClick({ classroomId: colId, classroomName: room?.name ?? "", day: selectedDay, ...base });
    } else if (view === "teacher") {
      onCellClick({ classroomId: s.classroom_id, classroomName: s.classroom_name ?? "", day: colId as DayKey, ...base });
    } else {
      const activeRoom = sortedRooms.find((r) => r.id === selectedRoom);
      onCellClick({ classroomId: activeRoom?.id ?? "", classroomName: activeRoom?.name ?? "", day: colId as DayKey, ...base });
    }
  }

  const gridCols = `${TIME_COL_W}px repeat(${cols.length}, 1fr)`;

  return (
    <div>
      {/* 탭 행 + 뷰 토글 (오른쪽) */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {view === "day"
            ? DAYS.map(({ key, label }) => (
                <TabBtn key={key} active={selectedDay === key} onClick={() => onDayChange(key)}>
                  {label}
                </TabBtn>
              ))
            : view === "teacher"
            ? teachers.map((name) => (
                <TabBtn key={name} active={activeTeacher === name} onClick={() => onTeacherChange?.(name)}>
                  {name}
                </TabBtn>
              ))
            : sortedRooms.map((room) => (
                <TabBtn key={room.id} active={selectedRoom === room.id} onClick={() => onRoomChange(room.id)}>
                  {room.name}
                </TabBtn>
              ))}
        </div>

        {/* 뷰 토글 — 오른쪽 */}
        <div className="flex items-center gap-1 p-0.5 rounded-xl flex-shrink-0"
             style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)" }}>
          {(["day", "room", "teacher"] as const).map((v) => (
            <button key={v} onClick={() => onViewChange(v)}
              className="px-3 py-1 rounded-lg text-xs font-bold transition-all duration-200"
              style={{
                background: view === v ? "var(--sc-green)"  : "transparent",
                color:      view === v ? "var(--sc-bg)"     : "var(--sc-dim)",
                border:     "none",
              }}>
              {v === "day" ? "요일" : v === "room" ? "교실" : "선생님"}
            </button>
          ))}
        </div>
      </div>

      {/* 그리드 박스 */}
      <div
        className="rounded-2xl sc-timetable-scroll"
        style={{
          border:     "1px solid var(--sc-border)",
          background: "var(--sc-surface)",
          overflowY:  "auto",
          maxHeight:  isWide ? "calc(100vh - 60px)" : "calc(100vh - 260px)",
        }}
      >
        {/* 컬럼 헤더 (sticky) */}
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: gridCols,
            position:            "sticky",
            top:                 0,
            zIndex:              20,
            background:          "var(--sc-raised)",
            borderBottom:        "1px solid var(--sc-border)",
          }}
        >
          {/* 시간열 헤더 여백 */}
          <div style={{ height: 36 }} />
          {cols.map((col) => {
            const isToday = (view === "room" || view === "teacher") && col.id === todayKey;
            return (
              <div
                key={col.id}
                style={{
                  textAlign:     "center",
                  padding:       "8px 4px",
                  fontSize:      11,
                  fontWeight:    isToday ? 800 : 700,
                  letterSpacing: "0.04em",
                  // 오늘: 텍스트 색만 강조, 테두리 없음
                  color:         isToday
                    ? "var(--sc-green)"
                    : hoveredCol === col.id ? "var(--sc-white)" : "var(--sc-dim)",
                  borderLeft:    "1px solid var(--sc-border)",
                  background:    "transparent",
                  transition:    "color 0.15s",
                }}
              >
                {col.label}
              </div>
            );
          })}
        </div>

        {/* 타임 그리드 */}
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: gridCols,
            height:              TOTAL_HEIGHT,
          }}
        >
          {/* 시간 레이블 컬럼 */}
          <div style={{ position: "relative", borderRight: "1px solid var(--sc-border)" }}>
            {HOUR_INDICES.map((i) => (
              <div
                key={i}
                style={{
                  position:   "absolute",
                  /* 08:00 레이블이 잘리지 않도록 첫 번째만 양수 offset */
                  top:        i === 0 ? 4 : i * pxPerHour - 8,
                  right:      6,
                  left:       0,
                  textAlign:  "right",
                  fontSize:   10,
                  fontWeight: 600,
                  color:      "var(--sc-dim)",
                  userSelect: "none",
                }}
              >
                {hhmm(indexToHour(i))}
              </div>
            ))}

            {/* 현재 시간 레이블 */}
            {nowPx !== null && (
              <div
                className="pointer-events-none"
                style={{
                  position:   "absolute",
                  top:        nowPx - 8,
                  right:      6,
                  left:       0,
                  textAlign:  "right",
                  fontSize:   10,
                  fontWeight: 800,
                  color:      "var(--sc-green)",
                  userSelect: "none",
                  zIndex:     16,
                }}
              >
                {(() => {
                  const now = new Date();
                  return `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
                })()}
              </div>
            )}
          </div>

          {/* 데이터 컬럼들 */}
          {cols.map((col) => {
            const blocks    = getBlocksForCol(col.id);
            const isHovered = hoveredCol === col.id;
            const isToday   = (view === "room" || view === "teacher") && col.id === todayKey;
            return (
              <div
                key={col.id}
                style={{
                  position:   "relative",
                  borderLeft: "1px solid var(--sc-border)",
                  cursor:     "crosshair",
                  background: "transparent",
                }}
                onClick={(e) => handleColumnClick(e, col.id)}
                onMouseEnter={() => setHoveredCol(col.id)}
                onMouseLeave={() => setHoveredCol(null)}
              >
                {/* 오늘/호버 열 강조 — 라운드 테두리 오버레이 */}
                {(isToday || isHovered) && (
                  <div
                    className="pointer-events-none"
                    style={{
                      position:     "absolute",
                      inset:        2,
                      borderRadius: 8,
                      border:       isToday
                        ? "2px solid var(--sc-green)"
                        : "1px solid var(--sc-dim)",
                      zIndex:       4,
                      transition:   "border-color 0.15s",
                    }}
                  />
                )}
                {/* 시간 구분선 */}
                {HOUR_INDICES.map((i) => (
                  <div key={i}>
                    <div style={{
                      position:   "absolute",
                      top:        i * pxPerHour,
                      left:       0,
                      right:      0,
                      height:     1,
                      background: "var(--sc-border)",
                    }} />
                    {i < TOTAL_HOURS && (
                      <div style={{
                        position:   "absolute",
                        top:        i * pxPerHour + pxPerHour / 2,
                        left:       0,
                        right:      0,
                        height:     1,
                        background: "var(--sc-border)",
                        opacity:    0.3,
                      }} />
                    )}
                  </div>
                ))}

                {/* 일정 블록들 */}
                {blocks.map((s) => (
                  <ScheduleBlock
                    key={s.id}
                    schedule={s}
                    pxPerHour={pxPerHour}
                    isDark={isDark}
                    view={view}
                    onClick={() => handleBlockClick(s, col.id)}
                  />
                ))}

                {/* 현재 시간 인디케이터 */}
                {nowPx !== null && <NowIndicator top={nowPx} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
