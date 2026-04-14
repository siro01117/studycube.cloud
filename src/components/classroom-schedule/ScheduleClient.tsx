"use client";

import { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ScheduleGrid,   { ScheduleEntry, CellClickInfo } from "./ScheduleGrid";
import EditModal,      { SaveData, Course }              from "./EditModal";
import ClassroomManagerModal                              from "./ClassroomManagerModal";
import ScheduleDetailModal, { DetailCellInfo, DeleteData } from "./ScheduleDetailModal";
import { ViewMode, DayKey, getMonday }                     from "./constants";
import ThemeToggle                                          from "@/components/ui/ThemeToggle";
import { HomeIcon, SearchIcon }                            from "@/components/ui/Icons";

// ── 타입 ──────────────────────────────────────────────────────
interface Classroom { id: string; name: string; floor?: number; }

interface RawSchedule {
  id:             string;
  day:            DayKey;
  start_time:     string;
  end_time:       string;
  effective_from: string;
  effective_until?: string | null;
  notes?:         string | null;
  // 상담 전용 컬럼
  consulting_student?:       string | null;
  consulting_teacher?:       string | null;
  consulting_teacher_color?: string | null;
  courses?: {
    id: string; name: string; subject?: string; instructor_id?: string; accent_color?: string;
    enrolled_names?: string[];
    instructors?: { id: string; name: string; color?: string };
  };
  classrooms?: { id: string; name: string };
}

// override 전용 타입 — any 제거
interface RawOverride {
  id:               string;
  classroom_id?:    string;
  day:              DayKey;
  start_time?:      string;
  end_time?:        string;
  is_cancelled:     boolean;
  override_type:    string;
  apply_from:       string;
  apply_until?:     string | null;
  weeks_count?:     number;
  base_schedule_id?: string;
  // 상담 전용 컬럼
  consulting_student?:       string | null;
  consulting_teacher?:       string | null;
  consulting_teacher_color?: string | null;
  courses?: {
    id: string; name: string; subject?: string; accent_color?: string;
    enrolled_names?: string[];
    instructors?: { id: string; name: string; color?: string };
  };
}

interface Props {
  classrooms:     Classroom[];
  fixedSchedules: RawSchedule[];
}

function normalize(s: RawSchedule): ScheduleEntry {
  return {
    id:              s.id,
    classroom_id:    s.classrooms?.id ?? "",
    classroom_name:  s.classrooms?.name,
    day:             s.day,
    start_time:      s.start_time.slice(0, 5),
    end_time:        s.end_time.slice(0, 5),
    course_id:       s.courses?.id,
    course_name:     s.courses?.name,
    course_subject:  s.courses?.subject,
    teacher_name:    s.courses?.instructors?.name  ?? (s.consulting_teacher || undefined),
    teacher_color:   s.courses?.instructors?.color ?? (s.consulting_teacher_color || undefined),
    course_accent:   s.courses?.accent_color,
    enrolled_names:  s.courses?.enrolled_names ?? [],
    notes:           s.notes ?? undefined,
    consulting_student:       s.consulting_student || undefined,
    consulting_teacher:       s.consulting_teacher || undefined,
    consulting_teacher_color: s.consulting_teacher_color || undefined,
    is_override:     false,
  };
}

function normalizeOverride(o: RawOverride, classrooms: Classroom[]): ScheduleEntry {
  const room = classrooms.find((c) => c.id === o.classroom_id);
  return {
    id:              o.id,
    classroom_id:    o.classroom_id ?? "",
    classroom_name:  room?.name,
    day:             o.day,
    start_time:      (o.start_time ?? "00:00").slice(0, 5),
    end_time:        (o.end_time   ?? "01:00").slice(0, 5),
    course_id:       o.courses?.id,
    course_name:     o.courses?.name,
    course_subject:  o.courses?.subject,
    teacher_name:    o.courses?.instructors?.name,
    teacher_color:   o.courses?.instructors?.color,
    course_accent:   o.courses?.accent_color,
    enrolled_names:  o.courses?.enrolled_names ?? [],
    consulting_student:       o.consulting_student || undefined,
    consulting_teacher:       o.consulting_teacher || undefined,
    consulting_teacher_color: o.consulting_teacher_color || undefined,
    is_override:     true,
  };
}

function NavLinks() {
  const linkStyle: React.CSSProperties = { color: "var(--sc-dim)", opacity: 0.6 };
  const hoverOn  = (e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity = "1");
  const hoverOff = (e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity = "0.6");
  return (
    <div className="flex items-center justify-between mb-5" style={{ flexWrap: "nowrap", gap: 6 }}>
      <div className="flex items-center gap-3" style={{ flexWrap: "nowrap", flexShrink: 0 }}>
        <Link href="/portal"
          className="flex items-center gap-1.5 text-xs font-semibold transition-all hover:opacity-100 w-fit"
          style={linkStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <HomeIcon size={14} /> 홈
        </Link>
        <span style={{ color: "var(--sc-border)", fontSize: 12 }}>·</span>
        <Link href="/manage/courses"
          className="text-xs font-semibold transition-all hover:opacity-100 w-fit"
          style={linkStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          수업 관리
        </Link>
      </div>
      <ThemeToggle />
    </div>
  );
}

// ── 가로 비율 감지 ────────────────────────────────────────────
function useIsWideLayout() {
  const [isWide, setIsWide] = useState(false);
  useLayoutEffect(() => {
    function check() { setIsWide(window.innerWidth / window.innerHeight > 1.4); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isWide;
}

// ── 브라우저 zoom 역보정 ──────────────────────────────────────
// outerWidth/innerWidth는 CSS px 기준이라 zoom해도 비율이 ~1로 고정 → 사용 불가.
// devicePixelRatio는 CSS zoom에 따라 실제로 변하는 값:
//   1x 모니터 100%→DPR=1, 150%→DPR=1.5 / 레티나(2x) 100%→DPR=2, 150%→DPR=3
// 최초 마운트 시 DPR 기준값을 캡처하고, 이후 변화량으로 CSS zoom 레벨을 역산.
// 원리: element.zoom = base / cssZoom → 시각적 크기 = base 배율로 항상 고정.
function useCounterZoom(base: number): number {
  const initialDPR = useRef<number>(1);
  const [zoom, setZoom] = useState(base);
  useLayoutEffect(() => {
    initialDPR.current = window.devicePixelRatio;   // 최초 DPR 기준값 캡처
    function update() {
      const cssZoom = window.devicePixelRatio / initialDPR.current;
      setZoom(base / Math.max(0.25, Math.min(4, cssZoom)));
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [base]);
  return zoom;
}


// ── 날짜 포맷 (년도 생략, 월~일 형식) ────────────────────────
function fmtWeekRange(monday: Date, sunday: Date): string {
  const m1 = monday.getMonth() + 1;
  const d1 = monday.getDate();
  const m2 = sunday.getMonth() + 1;
  const d2 = sunday.getDate();
  if (m1 === m2) {
    return `${m1}월 ${d1}일 ~ ${d2}일`;
  }
  return `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`;
}

// ── 주 네비게이터 ─────────────────────────────────────────────
function WeekNav({ weekOffset, setWeekOffset, compact = false }: {
  weekOffset:    number;
  setWeekOffset: (fn: (o: number) => number) => void;
  compact?:      boolean;
}) {
  const [pickerVal, setPickerVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const monday = getMonday(weekOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const isCurrentWeek = weekOffset === 0;

  function goToDate(dateStr: string) {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const thisMonday   = getMonday(0);
    const targetMonday = new Date(d);
    targetMonday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const diffWeeks = Math.round((targetMonday.getTime() - thisMonday.getTime()) / (7 * 86400000));
    setWeekOffset(() => diffWeeks);
  }

  function openPicker() {
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, "0");
    const d = String(monday.getDate()).padStart(2, "0");
    setPickerVal(`${y}-${m}-${d}`);
    setTimeout(() => inputRef.current?.showPicker?.(), 80);
  }

  const navBtn = (dir: -1 | 1) => (
    <button onClick={() => setWeekOffset((o) => o + dir)}
      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95 flex-shrink-0"
      style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)", color: "var(--sc-white)", fontSize: 13 }}>
      {dir === -1 ? "‹" : "›"}
    </button>
  );

  const dateBtn = (
    <div style={{ position: "relative" }}>
      <button onClick={openPicker}
        className="font-bold hover:opacity-70 transition-all text-left"
        style={{ fontSize: compact ? 13 : 14, color: "var(--sc-white)", lineHeight: 1.5 }}>
        {fmtWeekRange(monday, sunday)}
      </button>
      <input ref={inputRef} type="date" value={pickerVal}
        onChange={(e) => { setPickerVal(e.target.value); goToDate(e.target.value); }}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );

  const thisWeekBtn = (
    <button onClick={() => setWeekOffset(() => 0)}
      className="text-xs font-bold px-3 py-1 rounded-lg transition-all"
      style={{
        color:      isCurrentWeek ? "var(--sc-bg)"    : "var(--sc-dim)",
        background: isCurrentWeek ? "var(--sc-green)" : "var(--sc-raised)",
        border:     `1px solid ${isCurrentWeek ? "var(--sc-green)" : "var(--sc-border)"}`,
        opacity:    isCurrentWeek ? 1 : 0.8,
        flexShrink: 0,
      }}>
      이번 주
    </button>
  );

  if (compact) {
    return (
      <div className="space-y-2.5">
        {dateBtn}
        <div className="flex items-center gap-2">
          {navBtn(-1)}
          <div className="flex-1 flex justify-center">{thisWeekBtn}</div>
          {navBtn(1)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      {navBtn(-1)}
      {dateBtn}
      {navBtn(1)}
      {thisWeekBtn}
    </div>
  );
}

// ── 세션스토리지 필터 유지 키 ──────────────────────────────────
const FILTER_KEY = "sc_schedule_filter";

function loadFilter() {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveFilter(patch: Record<string, unknown>) {
  try {
    const current = loadFilter();
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ ...current, ...patch }));
  } catch { /* ignore */ }
}

// ── 주간 날짜 계산 헬퍼 ──────────────────────────────────────
function getWeekDates(weekOffset: number) {
  const monday = getMonday(weekOffset);
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 6);
  const mondayStr  = monday.toISOString().split("T")[0];
  const weekEndStr = weekEnd.toISOString().split("T")[0];
  return { monday, weekEnd, mondayStr, weekEndStr };
}

// ── 메인 ──────────────────────────────────────────────────────
export default function ScheduleClient({ classrooms, fixedSchedules }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router   = useRouter();
  const isWide   = useIsWideLayout();

  // 메뉴 크기 고정: 브라우저 zoom에 무관하게 항상 지정 배율로 보임
  const sidebarZoom = useCounterZoom(1.2); // 가로 사이드바: 항상 120% 크기
  const headerZoom  = useCounterZoom(0.9); // 세로 헤더: 항상 90% 크기


  // hydration 에러 방지: 서버/클라이언트 초기값 동일하게 기본값 사용
  // sessionStorage 복원은 useEffect에서 처리
  const [view,            setViewRaw]          = useState<ViewMode>("day");
  const [weekOffset,      setWeekOffset]       = useState(0);
  const [selectedDay,     setSelectedDayRaw]   = useState<DayKey>("mon");
  const [selectedRoom,    setSelectedRoomRaw]  = useState(classrooms[0]?.id ?? "");
  const [selectedTeacher, setSelectedTeacherRaw] = useState<string>("");

  // 래퍼: 상태 변경 + sessionStorage 저장
  function setView(v: ViewMode) { setViewRaw(v); saveFilter({ view: v }); }
  function setSelectedDay(d: DayKey) { setSelectedDayRaw(d); saveFilter({ selectedDay: d }); }
  function setSelectedRoom(id: string) { setSelectedRoomRaw(id); saveFilter({ selectedRoom: id }); }
  function setSelectedTeacher(name: string) { setSelectedTeacherRaw(name); saveFilter({ selectedTeacher: name }); }
  const [modalCell,       setModalCell]       = useState<CellClickInfo | null>(null);
  const [detailCell,      setDetailCell]      = useState<DetailCellInfo | null>(null);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [courses,         setCourses]         = useState<Course[]>([]);
  const [weeklyOverrides, setWeeklyOverrides] = useState<RawOverride[]>([]);

  const [preselectedCourse, setPreselectedCourse] = useState<Course | null>(null);

  // sessionStorage 복원 — hydration 후 실행
  useEffect(() => {
    const saved = loadFilter();
    if (saved.view)            setViewRaw(saved.view as ViewMode);
    if (saved.selectedDay)     setSelectedDayRaw(saved.selectedDay as DayKey);
    if (saved.selectedRoom)    setSelectedRoomRaw(saved.selectedRoom);
    if (saved.selectedTeacher !== undefined) setSelectedTeacherRaw(saved.selectedTeacher);
  }, []);

  // 수업 목록 (subject + instructor + 학생 포함)
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("courses")
      .select("id, name, subject, enrolled_names, instructors ( name, color )")
      .order("subject")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setCourses(data.map((c: Record<string, unknown>) => {
          const inst = c.instructors as { name?: string; color?: string } | null;
          return {
            id:              c.id as string,
            name:            (c.name as string) ?? "수업",
            subject:         (c.subject as string) ?? undefined,
            instructorName:  inst?.name  ?? undefined,
            instructorColor: inst?.color ?? undefined,
            enrolledNames:   (c.enrolled_names as string[]) ?? [],
          };
        }));
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // 주 오버라이드
  useEffect(() => {
    let cancelled = false;
    const { mondayStr, weekEndStr } = getWeekDates(weekOffset);

    supabase
      .from("schedule_overrides")
      .select(`
        id, classroom_id, day, start_time, end_time,
        is_cancelled, override_type, apply_from, apply_until,
        weeks_count, base_schedule_id,
        consulting_student, consulting_teacher, consulting_teacher_color,
        courses ( id, name, subject, accent_color, instructors ( id, name, color ) )
      `)
      .lte("apply_from", weekEndStr)
      .or(`apply_until.is.null,apply_until.gte.${mondayStr}`)
      .then(({ data }) => {
        if (!cancelled) setWeeklyOverrides((data as unknown as RawOverride[]) ?? []);
      });
    return () => { cancelled = true; };
  }, [weekOffset, supabase]);

  // ── 이번 주 유효 일정 합성 (useMemo로 캐싱) ───────────────
  const { mondayStr: startStr, weekEndStr: endStr } = useMemo(
    () => getWeekDates(weekOffset), [weekOffset]
  );
  const saturdayStr = endStr;

  const effectiveSchedules = useMemo(() => {
    const activeFixed = fixedSchedules
      .filter((s) => {
        const from  = s.effective_from ?? "0000-00-00";
        const until = s.effective_until;
        return from <= endStr && (until == null || until >= startStr);
      })
      .map(normalize);

    const cancelledBaseIds = new Set(
      weeklyOverrides
        .filter((o) => o.is_cancelled && o.base_schedule_id)
        .map((o) => o.base_schedule_id as string)
    );

    const tempAdditions = weeklyOverrides
      .filter((o) => !o.is_cancelled)
      .map((o) => normalizeOverride(o, classrooms));

    return [
      ...activeFixed.filter((s) => !cancelledBaseIds.has(s.id)),
      ...tempAdditions,
    ];
  }, [fixedSchedules, weeklyOverrides, classrooms, startStr, endStr]);

  // effectiveSchedules의 최신값을 ref로 유지 (useCallback dep 순환 방지)
  const effectiveRef = useRef(effectiveSchedules);
  effectiveRef.current = effectiveSchedules;

  // ── 셀 클릭 라우팅 ─────────────────────────────────────────
  function handleCellClick(info: CellClickInfo) {
    if (info.scheduleId) {
      // effectiveSchedules에서 해당 일정의 상담 필드 가져오기
      const sched = effectiveRef.current.find((s) => s.id === info.scheduleId);
      setDetailCell({
        classroomId:   info.classroomId,
        classroomName: info.classroomName,
        day:           info.day,
        courseId:      info.courseId,
        courseName:    info.courseName,
        teacherName:   info.teacherName,
        startTime:     info.startTime,
        endTime:       info.endTime,
        scheduleId:    info.scheduleId,
        notes:         info.notes,
        consultingStudent:      sched?.consulting_student,
        consultingTeacher:      sched?.consulting_teacher,
        consultingTeacherColor: sched?.consulting_teacher_color,
        isOverride:    info.isOverride,
      });
    } else {
      setPreselectedCourse(null);
      setModalCell(info);
    }
  }

  // ── 저장 핸들러 ─────────────────────────────────────────────
  const handleSave = useCallback(async (data: SaveData) => {
    const { monday, mondayStr, weekEndStr } = getWeekDates(weekOffset);
    const today = new Date().toISOString().split("T")[0];

    function calcUntil() {
      if (data.tempScope === "once") return weekEndStr;
      const w = data.weeksCount ?? 1;
      return new Date(monday.getTime() + (w - 1) * 7 * 86400000 + 6 * 86400000)
        .toISOString().split("T")[0];
    }

    if (data.action === "add") {
      const courseId = data.courseId ?? null;
      const days = data.selectedDays?.length ? data.selectedDays : [data.cell.day as DayKey];
      const st   = (data.startTime ?? data.cell.time) + ":00";
      const et   = (data.endTime   ?? data.cell.time) + ":00";
      const classroomId = data.classroomOverride ?? data.cell.classroomId;

      // ── 수정 모드: 기존 레코드 UPDATE ──────────────────────────
      if (data.cell.scheduleId) {
        const table = data.cell.isOverride ? "schedule_overrides" : "classroom_schedules";
        const { error } = await supabase.from(table).update({
          classroom_id: classroomId,
          day:          days[0],
          start_time:   st,
          end_time:     et,
          course_id:    courseId,
          consulting_student:       data.studentName || null,
          consulting_teacher:       data.consultingTeacher || null,
          consulting_teacher_color: data.consultingTeacherColor || null,
        }).eq("id", data.cell.scheduleId);

        if (error) {
          console.error("일정 수정 오류:", error);
          alert(`일정 수정 실패: ${error.message}`);
          return;
        }
        setModalCell(null);
        router.refresh();
        return;
      }

      if (data.addType === "permanent") {
        const { error } = await supabase.from("classroom_schedules").insert(
          days.map((day) => ({
            classroom_id:   classroomId,
            day,
            start_time:     st,
            end_time:       et,
            effective_from: today,
            ...(courseId ? { course_id: courseId } : {}),
            ...(data.studentName ? {
              consulting_student:       data.studentName,
              consulting_teacher:       data.consultingTeacher || null,
              consulting_teacher_color: data.consultingTeacherColor || null,
            } : {}),
          }))
        );
        if (error) {
          console.error("일정 추가 오류:", error);
          alert(`일정 추가 실패: ${error.message}`);
          return;
        }
      } else {
        const { error } = await supabase.from("schedule_overrides").insert(
          days.map((day) => ({
            classroom_id:  classroomId,
            day,
            start_time:    st,
            end_time:      et,
            is_cancelled:  false,
            override_type: "temporary",
            apply_from:    mondayStr,
            apply_until:   calcUntil(),
            weeks_count:   data.tempScope === "once" ? 1 : (data.weeksCount ?? 1),
            ...(courseId ? { course_id: courseId } : {}),
            ...(data.studentName ? {
              consulting_student:       data.studentName,
              consulting_teacher:       data.consultingTeacher || null,
              consulting_teacher_color: data.consultingTeacherColor || null,
            } : {}),
          }))
        );
        if (error) {
          console.error("임시 일정 추가 오류:", error);
          alert(`임시 일정 추가 실패: ${error.message}`);
          return;
        }
      }
    }

    setModalCell(null);
    router.refresh();
  }, [weekOffset, supabase, router]);

  // ── 삭제 핸들러 (ScheduleDetailModal) ───────────────────────
  const handleDelete = useCallback(async (data: DeleteData) => {
    const { monday, mondayStr, weekEndStr } = getWeekDates(weekOffset);

    function calcUntil() {
      if (data.tempScope === "once") return weekEndStr;
      const w = data.weeksCount ?? 1;
      return new Date(monday.getTime() + (w - 1) * 7 * 86400000 + 6 * 86400000)
        .toISOString().split("T")[0];
    }

    // ── override(임시 일정)는 schedule_overrides에서 직접 삭제 ──
    // base_schedule_id FK는 classroom_schedules만 참조하므로 override에 넣으면 오류
    if (data.isOverride) {
      const { error } = await supabase
        .from("schedule_overrides")
        .delete()
        .eq("id", data.scheduleId);
      if (error) {
        console.error("임시 일정 삭제 오류:", error);
        alert(`삭제 실패: ${error.message}`);
        return;
      }
      setDetailCell(null);
      router.refresh();
      return;
    }

    // ── 고정 일정 처리 ────────────────────────────────────────
    if (data.deleteType === "permanent") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const { error } = await supabase
        .from("classroom_schedules")
        .update({ effective_until: yesterdayStr })
        .eq("id", data.scheduleId);
      if (error) {
        console.error("일정 삭제 오류:", error);
        alert(`일정 삭제 실패: ${error.message}`);
        return;
      }
    } else {
      // 고정 일정 임시 취소 — base_schedule_id는 classroom_schedules를 참조
      const { error } = await supabase.from("schedule_overrides").insert({
        base_schedule_id: data.scheduleId,
        classroom_id:     data.classroomId,
        day:              data.day,
        start_time:       data.startTime + ":00",
        end_time:         data.endTime   + ":00",
        is_cancelled:     true,
        override_type:    "temporary",
        apply_from:       mondayStr,
        apply_until:      calcUntil(),
        weeks_count:      data.tempScope === "once" ? 1 : (data.weeksCount ?? 1),
      });
      if (error) {
        console.error("임시 삭제 오류:", error);
        alert(`임시 삭제 실패: ${error.message}`);
        return;
      }
    }

    setDetailCell(null);
    router.refresh();
  }, [weekOffset, supabase, router]);

  // ── 수정 핸들러 (ScheduleDetailModal → EditModal 재오픈) ────
  const handleEdit = useCallback((detail: DetailCellInfo) => {
    setDetailCell(null);

    const sched = effectiveRef.current.find((s) => s.id === detail.scheduleId);
    if (sched?.course_id) {
      const matched = courses.find((c) => c.id === sched.course_id);
      if (matched) setPreselectedCourse(matched);
    }

    setModalCell({
      classroomId:           detail.classroomId,
      classroomName:         detail.classroomName,
      day:                   detail.day,
      time:                  detail.startTime ?? "09:00",
      startTime:             detail.startTime,
      endTime:               detail.endTime,
      scheduleId:            detail.scheduleId,
      isOverride:            detail.isOverride,
      notes:                 detail.notes,
      consultingStudent:     detail.consultingStudent,
      consultingTeacher:     detail.consultingTeacher,
      consultingTeacherColor: detail.consultingTeacherColor,
    });
  }, [courses]);

  // ── existingSchedules 메모이제이션 ─────────────────────────
  const existingSchedulesSummary = useMemo(() =>
    effectiveSchedules.map((s) => ({
      id:              s.id,
      classroom_id:    s.classroom_id,
      day:             s.day,
      start_time:      s.start_time,
      end_time:        s.end_time,
      course_name:     s.course_name,
      course_subject:  s.course_subject,
    })),
    [effectiveSchedules]
  );

  // ── 공통 모달 ──────────────────────────────────────────────
  const modals = (
    <>
      <EditModal
        cell={modalCell}
        courses={courses}
        preselectedCourse={preselectedCourse}
        onClose={() => { setModalCell(null); setPreselectedCourse(null); }}
        onSave={handleSave}
        viewMode={view}
        activeTeacher={selectedTeacher}
        classrooms={classrooms}
        existingSchedules={existingSchedulesSummary}
      />
      <ScheduleDetailModal
        cell={detailCell}
        weekSaturdayStr={saturdayStr}
        onClose={() => setDetailCell(null)}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />
      {showRoomManager && (
        <ClassroomManagerModal
          classrooms={classrooms}
          onClose={() => setShowRoomManager(false)}
          onRefresh={() => router.refresh()}
        />
      )}
    </>
  );

  // ── 공통 그리드 ─────────────────────────────────────────────
  const grid = (
    <ScheduleGrid
      view={view}
      classrooms={classrooms}
      schedules={effectiveSchedules}
      selectedDay={selectedDay}
      selectedRoom={selectedRoom}
      selectedTeacher={selectedTeacher}
      onDayChange={setSelectedDay}
      onRoomChange={setSelectedRoom}
      onTeacherChange={setSelectedTeacher}
      onCellClick={handleCellClick}
      onViewChange={setView}
      isWide={isWide}
    />
  );

  // ── 가로 비율 레이아웃 (사이드바) ───────────────────────────
  if (isWide) {
    return (
      <div style={{
        display:    "flex",
        height:     "100vh",   // 페이지 스크롤 없음 — 우측 뷰포트가 내부 스크롤
        background: "var(--sc-bg)",
      }}>
        {/* 좌측 사이드바 — 항상 120% 크기로 고정 (브라우저 zoom 역보정)
            width: 260 고정 + zoom: sidebarZoom → 시각적 크기 260×1.2=312px 불변 */}
        <div style={{
          width:         260,
          flexShrink:    0,
          position:      "sticky",
          top:           0,
          height:        "100vh",
          overflowY:     "auto",
          borderRight:   "1px solid var(--sc-border)",
          background:    "var(--sc-bg)",
          padding:       "24px 20px",
          display:       "flex",
          flexDirection: "column",
          gap:           20,
          zoom:          sidebarZoom,
        }}>
          <NavLinks />

          {/* 타이틀 + 교실 정보 버튼 */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1"
               style={{ color: "var(--sc-dim)" }}>Management</p>
            <div className="flex items-center gap-2" style={{ flexWrap: "nowrap" }}>
              <h1 className="text-xl font-black" style={{ color: "var(--sc-white)", whiteSpace: "nowrap" }}>교실 시간표</h1>
              <button onClick={() => setShowRoomManager(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold
                           transition-all duration-200 hover:opacity-80 active:scale-95"
                style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)", whiteSpace: "nowrap", flexShrink: 0 }}>
                <SearchIcon size={14} /> 교실 정보
              </button>
            </div>
          </div>

          {/* 주간 네비게이터 (compact 세로 배치) */}
          <WeekNav weekOffset={weekOffset} setWeekOffset={setWeekOffset} compact />
        </div>

        {/* 우측 시간표 스크롤 뷰포트 — 내부 스크롤 */}
        <div style={{
          width:      780,
          flexShrink: 0,
          height:     "100vh",
          overflow:   "auto",
        }}>
          <div style={{ padding: "12px 20px 40px" }}>
            {grid}
          </div>
        </div>

        {modals}
      </div>
    );
  }

  // ── 세로 비율 레이아웃 (기존 상단 헤더) ─────────────────────
  return (
    <div className="min-h-screen" style={{ background: "var(--sc-bg)" }}>
      {/* 스티키 헤더 — zoom: headerZoom으로 브라우저 zoom과 무관하게 항상 90% 크기 유지 */}
      <div className="sticky top-0 z-30"
           style={{ background: "var(--sc-bg)", borderBottom: "1px solid var(--sc-border)", backdropFilter: "blur(12px)" }}>
        <div style={{ zoom: headerZoom, padding: "20px 32px 12px" }}>
          <NavLinks />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
                 style={{ color: "var(--sc-dim)" }}>Management</p>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black" style={{ color: "var(--sc-white)" }}>교실 시간표</h1>
                <button onClick={() => setShowRoomManager(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold
                             transition-all duration-200 hover:opacity-80 active:scale-95"
                  style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                  <SearchIcon size={14} /> 교실 정보
                </button>
              </div>
            </div>
          </div>
          <WeekNav weekOffset={weekOffset} setWeekOffset={setWeekOffset} />
        </div>
      </div>

      {/* 세로 레이아웃 — 고정 820px, 브라우저 zoom 시 캔버스처럼 비례 스케일 */}
      <div style={{
        width:   820,
        margin:  "0 auto",
        padding: "20px 32px",
      }}>
        {grid}
      </div>

      {modals}
    </div>
  );
}
