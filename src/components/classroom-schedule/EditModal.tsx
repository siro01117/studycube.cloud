"use client";

import { useState, useEffect, useRef } from "react";
import { DAYS, DayKey } from "./constants";

// ── 타입 ──────────────────────────────────────────────────────
type AddType    = "permanent" | "temporary";
type DeleteType = "permanent" | "temporary";
type TempScope  = "once" | "weeks";

export interface Course {
  id:              string;
  name:            string;       // auto-generated (fallback)
  subject?:        string;
  instructorName?: string;
  instructorColor?: string;
  enrolledNames?:  string[];
}

/** 블록 표시용 라벨 — subject 우선, 없으면 name */
function courseLabel(c: Course) {
  return c.subject || c.name || "수업";
}

interface CellInfo {
  classroomId:   string;
  classroomName: string;
  day:           string;
  time:          string;
  scheduleId?:   string;
  courseName?:   string;
  teacherName?:  string;
  startTime?:    string;
  endTime?:      string;
}

interface Classroom { id: string; name: string; }

interface ExistingSchedule {
  classroom_id: string;
  day:          string;
  start_time:   string;
  end_time:     string;
  course_name?: string;
  course_subject?: string;
}

interface Props {
  cell:               CellInfo | null;
  courses:            Course[];
  preselectedCourse?: Course | null;
  onClose:            () => void;
  onSave:             (data: SaveData) => void;
  // 선생님 뷰 지원
  viewMode?:          string;
  activeTeacher?:     string;
  classrooms?:        Classroom[];
  existingSchedules?: ExistingSchedule[];
}

export interface SaveData {
  cell:              CellInfo;
  action:            "add" | "delete";
  // 추가
  addType?:          AddType;
  selectedDays?:     DayKey[];
  startTime?:        string;
  endTime?:          string;
  courseId?:         string;
  newCourseName?:    string;
  classroomOverride?: string;  // 선생님 뷰에서 교실 직접 지정
  // 삭제
  deleteType?:       DeleteType;
  // 임시 공통
  tempScope?:        TempScope;
  weeksCount?:       number;
}

const DAY_LABEL: Record<string, string> = {
  mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일",
};

function addHour(t: string) {
  const [h, m] = t.split(":").map(Number);
  const nh = Math.floor((h * 60 + m + 60) / 60) % 24;
  const nm = (h * 60 + m + 60) % 60;
  return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
}

/** HH:MM → 분 */
function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── 교실 선택 드롭다운 (테마 스타일) ──────────────────────────
const crDropdownScrollCSS = `
.cr-dropdown-list::-webkit-scrollbar { width: 6px; }
.cr-dropdown-list::-webkit-scrollbar-track { background: transparent; }
.cr-dropdown-list::-webkit-scrollbar-thumb { background: var(--sc-border); border-radius: 3px; }
.cr-dropdown-list::-webkit-scrollbar-thumb:hover { background: var(--sc-dim); }
`;

function ClassroomDropdown({ classrooms, value, onSelect }: {
  classrooms: { id: string; name: string }[];
  value:      string;
  onSelect:   (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const selected = classrooms.find((cr) => cr.id === value);
  const label = selected ? selected.name : "교실 선택...";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <style dangerouslySetInnerHTML={{ __html: crDropdownScrollCSS }} />
      <div className="sc-input text-sm w-full flex items-center justify-between"
           style={{ padding: "10px 12px", cursor: "pointer", color: selected ? "var(--sc-white)" : "var(--sc-dim)", fontWeight: selected ? 700 : 400 }}
           onClick={() => setOpen(!open)}>
        <span className="truncate">{label}</span>
        {/* 화살표 아이콘 */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ flexShrink: 0, opacity: 0.5, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {open && (
        <div className="cr-dropdown-list" style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--sc-surface)", border: "1px solid var(--sc-border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          maxHeight: 220, overflowY: "auto",
        }}>
          {classrooms.map((cr) => {
            const active = cr.id === value;
            return (
              <button key={cr.id}
                onClick={() => { onSelect(cr.id); setOpen(false); }}
                className="w-full text-left"
                style={{
                  padding: "10px 14px", display: "block",
                  borderBottom: "1px solid var(--sc-border)",
                  background: active ? "var(--sc-raised)" : "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sc-raised)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--sc-raised)" : "transparent")}
              >
                <p style={{ fontSize: 13, fontWeight: 700, color: active ? "var(--sc-green)" : "var(--sc-white)" }}>{cr.name}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 수업 검색 ─────────────────────────────────────────────────
function CourseSearchInput({ courses, value, onSelect }: {
  courses:  Course[];
  value:    Course | null;
  onSelect: (c: Course | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const q = query.toLowerCase();
  const filtered = courses.filter((c) =>
    courseLabel(c).toLowerCase().includes(q) ||
    (c.instructorName ?? "").toLowerCase().includes(q)
  );

  // ── 선택된 상태 ───────────────────────────────────────────
  if (value) return (
    <div className="sc-input" style={{ padding: "10px 12px" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* 선생님T - 과목 */}
          <p className="text-sm font-bold truncate" style={{ color: "var(--sc-white)" }}>
            {value.instructorName ? `${value.instructorName}T - ${courseLabel(value)}` : courseLabel(value)}
          </p>
          {/* 학생 이름 콤마 구분 */}
          {(value.enrolledNames?.length ?? 0) > 0 && (
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--sc-dim)" }}>
              {value.enrolledNames!.join(", ")}
            </p>
          )}
        </div>
        <button onClick={() => { onSelect(null); setQuery(""); }}
                className="hover:opacity-60 flex-shrink-0" style={{ color: "var(--sc-dim)" }}>×</button>
      </div>
    </div>
  );

  // ── 검색 드롭다운 ─────────────────────────────────────────
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="과목명 또는 선생님 이름 검색..."
        className="sc-input text-sm w-full"
        style={{ padding: "10px 12px" }}
        autoFocus
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--sc-surface)", border: "1px solid var(--sc-border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          maxHeight: 260, overflowY: "auto",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--sc-dim)" }}>
              {query ? "검색 결과 없음" : "수업 목록 없음"}
            </div>
          ) : filtered.map((c) => (
            <button key={c.id}
              onClick={() => { onSelect(c); setOpen(false); setQuery(""); }}
              className="w-full text-left"
              style={{ padding: "10px 14px", display: "block", borderBottom: "1px solid var(--sc-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sc-raised)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {/* (이름)T - (과목) */}
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-white)", marginBottom: 3 }}>
                {c.instructorName ? `${c.instructorName}T - ${courseLabel(c)}` : courseLabel(c)}
              </p>
              {/* 학생 이름 콤마 구분 */}
              {(c.enrolledNames?.length ?? 0) > 0 && (
                <p style={{ fontSize: 11, color: "var(--sc-dim)", marginTop: 2 }}>
                  {c.enrolledNames!.join(", ")}
                </p>
              )}
            </button>
          ))}

          {/* 수업 추가는 수업 관리에서 */}
          <a href="/manage/courses" target="_blank" rel="noreferrer"
            style={{
              display: "block", padding: "10px 14px", fontSize: 12, fontWeight: 600,
              color: "var(--sc-dim)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sc-raised)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >+ 수업 추가는 → 수업 관리 페이지에서</a>
        </div>
      )}
    </div>
  );
}

// ── 임시 범위 선택기 ──────────────────────────────────────────
function TempScopeSelector({ scope, setScope, weeks, setWeeks }: {
  scope: TempScope; setScope: (s: TempScope) => void;
  weeks: number;   setWeeks: (n: number) => void;
}) {
  return (
    <div className="p-4 rounded-xl animate-fade-up"
         style={{ background:"var(--sc-raised)", border:"1px solid var(--sc-border)", animationFillMode:"forwards" }}>
      <p className="text-[11px] font-bold uppercase tracking-widest mb-3"
         style={{ color:"var(--sc-dim)" }}>적용 기간</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(["once","weeks"] as TempScope[]).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className="py-2 rounded-lg text-xs font-bold transition-all duration-200"
            style={{
              background: scope === s ? "var(--sc-green)"  : "var(--sc-surface)",
              color:      scope === s ? "var(--sc-bg)"     : "var(--sc-dim)",
              border:     `1px solid ${scope === s ? "var(--sc-green)" : "var(--sc-border)"}`,
            }}>
            {s === "once" ? "이번 주만" : "N주 동안"}
          </button>
        ))}
      </div>
      {scope === "weeks" && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => setWeeks(Math.max(1, weeks - 1))}
            className="w-9 h-9 rounded-full text-lg font-black flex items-center justify-center
                       transition-all hover:scale-110 active:scale-95"
            style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", color:"var(--sc-white)" }}>−</button>
          <div className="text-center min-w-[60px]">
            <span className="text-3xl font-black" style={{ color:"var(--sc-green)" }}>{weeks}</span>
            <span className="text-sm ml-1" style={{ color:"var(--sc-dim)" }}>주</span>
          </div>
          <button onClick={() => setWeeks(Math.min(52, weeks + 1))}
            className="w-9 h-9 rounded-full text-lg font-black flex items-center justify-center
                       transition-all hover:scale-110 active:scale-95"
            style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", color:"var(--sc-white)" }}>+</button>
        </div>
      )}
    </div>
  );
}

// ── 메인 모달 ─────────────────────────────────────────────────
export default function EditModal({
  cell, courses, preselectedCourse, onClose, onSave,
  viewMode, activeTeacher, classrooms = [], existingSchedules = [],
}: Props) {
  const isEdit = !!cell?.scheduleId;
  const isTeacherView = viewMode === "teacher";

  // 추가 상태
  const [selectedCourse,   setSelectedCourse]   = useState<Course | null>(null);
  const [selectedDays,     setSelectedDays]      = useState<DayKey[]>([]);
  const [startTime,        setStartTime]         = useState("14:00");
  const [endTime,          setEndTime]           = useState("15:00");
  const [addType,          setAddType]           = useState<AddType>("permanent");
  // 선생님 뷰: 교실 선택
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>("");
  // 선생님 뷰: 선생님 선택 (필터용)
  const [filterTeacher,    setFilterTeacher]     = useState<string>(activeTeacher ?? "");
  // 충돌 에러
  const [conflictError,    setConflictError]     = useState<string | null>(null);

  // 삭제 상태
  const [deleteType, setDeleteType] = useState<DeleteType>("temporary");

  // 임시 공통
  const [tempScope, setTempScope] = useState<TempScope>("once");
  const [weeks,     setWeeks]     = useState(2);

  // preselectedCourse가 들어오면 자동 선택
  useEffect(() => {
    if (preselectedCourse) setSelectedCourse(preselectedCourse);
  }, [preselectedCourse]);

  useEffect(() => {
    if (!cell) return;
    const st = cell.startTime ?? cell.time;
    setStartTime(st);
    setEndTime(cell.endTime ?? addHour(st));
    setSelectedDays([cell.day as DayKey]);
    setSelectedCourse(null);
    setAddType("permanent");
    setDeleteType("temporary");
    setTempScope("once");
    setWeeks(2);
    setConflictError(null);
    // 교실 뷰에서 열면 해당 교실 기본 선택
    if (isTeacherView && classrooms.length > 0) {
      setSelectedClassroomId(classrooms[0].id);
    } else {
      setSelectedClassroomId("");
    }
    setFilterTeacher(activeTeacher ?? "");
  }, [cell]);

  if (!cell) return null;

  function toggleDay(d: DayKey) {
    setSelectedDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d]);
  }

  // 선생님 필터 적용된 수업 목록
  const filteredCourses = isTeacherView && filterTeacher
    ? courses.filter((c) => c.instructorName === filterTeacher)
    : courses;

  // 선생님 목록 (전체 courses에서 추출)
  const allTeachers = Array.from(new Set(
    courses.map((c) => c.instructorName).filter(Boolean) as string[]
  )).sort();

  /** 충돌 검사: 선택된 교실 × 요일 × 시간이 기존 일정과 겹치는지 확인 */
  function findConflict(classroomId: string, day: DayKey, sTime: string, eTime: string): ExistingSchedule | null {
    const sMin = toMin(sTime);
    const eMin = toMin(eTime);
    for (const s of existingSchedules) {
      if (s.classroom_id !== classroomId) continue;
      if (s.day !== day) continue;
      const existS = toMin(s.start_time);
      const existE = toMin(s.end_time);
      // 겹치는 조건: sMin < existE && eMin > existS
      if (sMin < existE && eMin > existS) return s;
    }
    return null;
  }

  function submit(action: "add" | "delete") {
    setConflictError(null);

    // 추가 시 충돌 검사
    if (action === "add" && isTeacherView && selectedClassroomId) {
      for (const day of selectedDays) {
        const conflict = findConflict(selectedClassroomId, day, startTime, endTime);
        if (conflict) {
          const conflictName = conflict.course_subject || conflict.course_name || "다른 수업";
          const dayLabel = DAY_LABEL[day] ?? day;
          setConflictError(
            `${dayLabel}요일 일정이 "${conflictName}"과(와) 겹칩니다. 추가할 수 없습니다.`
          );
          return;
        }
      }
    } else if (action === "add" && !isTeacherView) {
      // 교실 기반 뷰에서도 충돌 검사
      const classroomId = cell!.classroomId;
      for (const day of selectedDays) {
        const conflict = findConflict(classroomId, day, startTime, endTime);
        if (conflict) {
          const conflictName = conflict.course_subject || conflict.course_name || "다른 수업";
          const dayLabel = DAY_LABEL[day] ?? day;
          setConflictError(
            `${dayLabel}요일 일정이 "${conflictName}"과(와) 겹칩니다. 추가할 수 없습니다.`
          );
          return;
        }
      }
    }

    const isTemp = action === "add" ? addType === "temporary" : deleteType === "temporary";
    onSave({
      cell:             cell!,
      action,
      addType:          action === "add"    ? addType    : undefined,
      deleteType:       action === "delete" ? deleteType : undefined,
      selectedDays:     action === "add"    ? selectedDays  : undefined,
      startTime:        action === "add"    ? startTime     : undefined,
      endTime:          action === "add"    ? endTime       : undefined,
      courseId:         action === "add"    ? selectedCourse?.id  : undefined,
      classroomOverride: (action === "add" && isTeacherView && selectedClassroomId)
                          ? selectedClassroomId : undefined,
      tempScope:        isTemp ? tempScope : undefined,
      weeksCount:       isTemp && tempScope === "weeks" ? weeks : undefined,
    });
  }

  const dayLabel = DAY_LABEL[cell.day] ?? cell.day;

  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 z-40"
           style={{ background:"rgba(0,0,0,0.65)", backdropFilter:"blur(4px)" }}
           onClick={onClose} />

      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-md rounded-2xl p-6 shadow-2xl animate-scale-in"
           style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)",
                    animationFillMode:"forwards", maxHeight:"90vh", overflowY:"auto" }}>

        {/* 헤더 */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1"
               style={{ color:"var(--sc-dim)" }}>
              {isTeacherView
                ? `선생님 뷰 · ${dayLabel}요일`
                : `${cell.classroomName} · ${dayLabel}요일`}
            </p>
            <h3 className="font-black text-lg" style={{ color:"var(--sc-white)" }}>
              {isEdit ? "일정 관리" : "일정 추가"}
            </h3>
            {isEdit && (
              <p className="text-sm mt-0.5" style={{ color:"var(--sc-dim)" }}>
                {cell.courseName ?? "수업"}
                {cell.teacherName ? ` · ${cell.teacherName}` : ""}
                {cell.startTime ? ` · ${cell.startTime}~${cell.endTime}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60"
                  style={{ color:"var(--sc-dim)" }}>×</button>
        </div>

        {/* ── 추가 폼 ─────────────────────────────────────────── */}
        {!isEdit && (
          <div className="space-y-4 mb-5">

            {/* 선생님 뷰: 교실 선택 */}
            {isTeacherView && classrooms.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                   style={{ color:"var(--sc-dim)" }}>교실</p>
                <ClassroomDropdown
                  classrooms={classrooms}
                  value={selectedClassroomId}
                  onSelect={(id) => { setSelectedClassroomId(id); setConflictError(null); }}
                />
              </div>
            )}

            {/* 선생님 뷰: 선생님 필터 선택 */}
            {isTeacherView && allTeachers.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                   style={{ color:"var(--sc-dim)" }}>선생님</p>
                <div className="flex gap-1.5 flex-wrap">
                  {allTeachers.map((t) => {
                    const on = filterTeacher === t;
                    return (
                      <button key={t} onClick={() => { setFilterTeacher(t); setSelectedCourse(null); }}
                        className="px-3 h-8 rounded-lg text-xs font-bold transition-all duration-150"
                        style={{
                          background: on ? "var(--sc-green)"  : "var(--sc-raised)",
                          color:      on ? "var(--sc-bg)"     : "var(--sc-dim)",
                          border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                        }}>
                        {t}T
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 수업 */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                 style={{ color:"var(--sc-dim)" }}>수업</p>
              <CourseSearchInput
                courses={filteredCourses}
                value={selectedCourse}
                onSelect={setSelectedCourse}
              />
            </div>

            {/* 요일 */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                 style={{ color:"var(--sc-dim)" }}>요일 (중복 가능)</p>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map(({ key, label }) => {
                  const on = selectedDays.includes(key);
                  return (
                    <button key={key} onClick={() => { toggleDay(key); setConflictError(null); }}
                      className="w-9 h-9 rounded-lg text-sm font-bold transition-all duration-150"
                      style={{
                        background: on ? "var(--sc-green)"  : "var(--sc-raised)",
                        color:      on ? "var(--sc-bg)"     : "var(--sc-dim)",
                        border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                        transform:  on ? "scale(1.08)" : "scale(1)",
                      }}>{label}</button>
                  );
                })}
              </div>
            </div>

            {/* 시간 */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                 style={{ color:"var(--sc-dim)" }}>시간</p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <p className="text-[10px] mb-1" style={{ color:"var(--sc-dim)" }}>시작</p>
                  <input type="time" step="300" value={startTime}
                    onChange={(e) => { setStartTime(e.target.value); setEndTime(addHour(e.target.value)); setConflictError(null); }}
                    className="sc-input text-sm w-full" style={{ padding:"9px 10px" }} />
                </div>
                <span style={{ color:"var(--sc-dim)", marginTop:18 }}>→</span>
                <div className="flex-1">
                  <p className="text-[10px] mb-1" style={{ color:"var(--sc-dim)" }}>종료</p>
                  <input type="time" step="300" value={endTime}
                    onChange={(e) => { setEndTime(e.target.value); setConflictError(null); }}
                    className="sc-input text-sm w-full" style={{ padding:"9px 10px" }} />
                </div>
              </div>
            </div>

            {/* 추가 유형 */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                 style={{ color:"var(--sc-dim)" }}>추가 유형</p>
              <div className="grid grid-cols-2 gap-2">
                {(["permanent","temporary"] as AddType[]).map((t) => (
                  <button key={t} onClick={() => setAddType(t)}
                    className="py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
                    style={{
                      background: addType === t ? "var(--sc-green)"  : "var(--sc-raised)",
                      color:      addType === t ? "var(--sc-bg)"     : "var(--sc-dim)",
                      border:     `1px solid ${addType === t ? "var(--sc-green)" : "var(--sc-border)"}`,
                      transform:  addType === t ? "scale(1.02)" : "scale(1)",
                    }}>
                    {t === "permanent" ? "고정 추가" : "⏱ 임시 추가"}
                  </button>
                ))}
              </div>
            </div>

            {/* 임시 추가 → 기간 */}
            {addType === "temporary" && (
              <TempScopeSelector scope={tempScope} setScope={setTempScope} weeks={weeks} setWeeks={setWeeks} />
            )}

            {/* 충돌 에러 */}
            {conflictError && (
              <div style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                fontSize: 12,
                color: "#f87171",
                fontWeight: 600,
              }}>
                ⚠️ {conflictError}
              </div>
            )}
          </div>
        )}

        {/* ── 삭제 폼 (기존 일정 클릭) ────────────────────────── */}
        {isEdit && (
          <div className="space-y-4 mb-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
                 style={{ color:"var(--sc-dim)" }}>삭제 유형</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { type:"temporary" as DeleteType, label:"⏱ 임시 삭제", sub:"이 기간만 취소" },
                  { type:"permanent" as DeleteType, label:"🗑 고정 삭제", sub:"오늘 이후 완전 삭제" },
                ]).map(({ type, label, sub }) => (
                  <button key={type} onClick={() => setDeleteType(type)}
                    className="py-3 rounded-xl text-sm font-bold transition-all duration-200 flex flex-col items-center gap-0.5"
                    style={{
                      background: deleteType === type
                        ? (type === "permanent" ? "rgba(239,68,68,0.15)" : "var(--sc-raised)")
                        : "var(--sc-raised)",
                      color:  deleteType === type
                        ? (type === "permanent" ? "#f87171" : "var(--sc-white)")
                        : "var(--sc-dim)",
                      border: `1px solid ${deleteType === type
                        ? (type === "permanent" ? "rgba(239,68,68,0.4)" : "var(--sc-green)")
                        : "var(--sc-border)"}`,
                      transform: deleteType === type ? "scale(1.02)" : "scale(1)",
                    }}>
                    {label}
                    <span style={{ fontSize:10, fontWeight:400, opacity:0.7 }}>{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 임시 삭제 → 기간 */}
            {deleteType === "temporary" && (
              <TempScopeSelector scope={tempScope} setScope={setTempScope} weeks={weeks} setWeeks={setWeeks} />
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose}
            className="py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
            취소
          </button>
          <button onClick={() => submit(isEdit ? "delete" : "add")}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{
              background: isEdit && deleteType === "permanent" ? "rgba(239,68,68,0.2)" : "var(--sc-green)",
              color:      isEdit && deleteType === "permanent" ? "#f87171" : "var(--sc-bg)",
              border:     isEdit && deleteType === "permanent" ? "1px solid rgba(239,68,68,0.4)" : "none",
            }}>
            {isEdit
              ? (deleteType === "permanent" ? "고정 삭제" : "임시 삭제")
              : "추가"}
          </button>
        </div>
      </div>
    </>
  );
}
