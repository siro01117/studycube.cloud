"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// ── 타입 ──────────────────────────────────────────────────────
type DeleteType = "permanent" | "temporary";
type TempScope  = "once" | "weeks";

interface CourseDetail {
  id:            string;
  subject?:      string;
  accent_color:  string;
  instructor?: {
    id:    string;
    name:  string;
    color: string;
  };
  enrolledNames: string[];
  memo?:         string;
}

export interface DetailCellInfo {
  classroomId:   string;
  classroomName: string;
  day:           string;
  courseId?:     string;
  courseName?:   string;
  teacherName?:  string;
  startTime?:    string;
  endTime?:      string;
  scheduleId:    string;
  notes?:        string;
  // 상담 전용 필드
  consultingStudent?:      string;
  consultingTeacher?:      string;
  consultingTeacherColor?: string;
  isOverride?:   boolean;
}

export interface DeleteData {
  scheduleId:  string;
  classroomId: string;
  day:         string;
  startTime:   string;
  endTime:     string;
  deleteType:  DeleteType;
  tempScope?:  TempScope;
  weeksCount?: number;
  isOverride?: boolean;  // 임시 일정 여부 — override는 schedule_overrides에서 직접 삭제
}

interface Props {
  cell:    DetailCellInfo | null;
  weekSaturdayStr: string;
  onClose:  () => void;
  onDelete: (data: DeleteData) => void;
  onEdit:   (cell: DetailCellInfo) => void;
}

const DAY_LABEL: Record<string, string> = {
  mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일",
};

// ── 임시 범위 선택기 ──────────────────────────────────────────
function TempScopeSelector({ scope, setScope, weeks, setWeeks }: {
  scope: TempScope; setScope: (s: TempScope) => void;
  weeks: number;   setWeeks: (n: number) => void;
}) {
  return (
    <div className="p-4 rounded-xl"
         style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)" }}>
      <p className="text-[11px] font-bold uppercase tracking-widest mb-3"
         style={{ color: "var(--sc-dim)" }}>적용 기간</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(["once","weeks"] as TempScope[]).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className="py-2 rounded-lg text-xs font-bold transition-all"
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
            className="w-9 h-9 rounded-full text-lg font-black flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", color: "var(--sc-white)" }}>−</button>
          <div className="text-center min-w-[60px]">
            <span className="text-3xl font-black" style={{ color: "var(--sc-green)" }}>{weeks}</span>
            <span className="text-sm ml-1" style={{ color: "var(--sc-dim)" }}>주</span>
          </div>
          <button onClick={() => setWeeks(Math.min(52, weeks + 1))}
            className="w-9 h-9 rounded-full text-lg font-black flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", color: "var(--sc-white)" }}>+</button>
        </div>
      )}
    </div>
  );
}

// ── 메인 모달 ─────────────────────────────────────────────────
export default function ScheduleDetailModal({ cell, weekSaturdayStr, onClose, onDelete, onEdit }: Props) {
  const supabase = createClient();
  const [course,     setCourse]     = useState<CourseDetail | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [deleteType, setDeleteType] = useState<DeleteType>("temporary");
  const [tempScope,  setTempScope]  = useState<TempScope>("once");
  const [weeks,      setWeeks]      = useState(2);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (!cell?.courseId) { setCourse(null); return; }
    setLoading(true);
    setCourse(null);
    setShowDelete(false);
    setDeleteType("temporary");
    setTempScope("once");
    setWeeks(2);

    supabase
      .from("courses")
      .select(`
        id, subject, accent_color, enrolled_names, memo,
        instructors ( id, name, color )
      `)
      .eq("id", cell.courseId)
      .single()
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }
        const d = data as any;
        setCourse({
          id:            d.id,
          subject:       d.subject,
          accent_color:  d.accent_color ?? "#6366f1",
          instructor:    d.instructors ? {
            id:    d.instructors.id,
            name:  d.instructors.name ?? "",
            color: d.instructors.color ?? "#1e293b",
          } : undefined,
          enrolledNames: d.enrolled_names ?? [],
          memo:          d.memo,
        });
        setLoading(false);
      });
  }, [cell?.courseId, cell?.scheduleId]);

  if (!cell) return null;

  const dayLabel    = DAY_LABEL[cell.day] ?? cell.day;
  const isConsulting = !cell.courseId && !!(cell.consultingStudent || cell.notes);
  const studentNote  = cell.consultingStudent ?? "";
  const teacherNote  = cell.consultingTeacher ?? "";
  const colorNote    = cell.consultingTeacherColor ?? "";

  function submitDelete() {
    if (!cell) return;
    onDelete({
      scheduleId:  cell.scheduleId,
      classroomId: cell.classroomId,
      day:         cell.day,
      startTime:   cell.startTime ?? "",
      endTime:     cell.endTime   ?? "",
      deleteType,
      tempScope:   deleteType === "temporary" ? tempScope : undefined,
      weeksCount:  deleteType === "temporary" && tempScope === "weeks" ? weeks : undefined,
      isOverride:  cell.isOverride,
    });
  }

  const accent    = isConsulting ? (colorNote || "#6366f1") : (course?.accent_color ?? "#6366f1");
  const instColor = isConsulting ? (colorNote || "#1e293b") : (course?.instructor?.color ?? "#1e293b");

  return (
    <>
      <div className="fixed inset-0 z-40"
           style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
           onClick={onClose} />

      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-md rounded-2xl shadow-2xl animate-scale-in overflow-hidden"
           style={{ border: "1px solid var(--sc-border)", animationFillMode: "forwards", maxHeight: "88vh" }}>

        {/* 컬러 헤더 */}
        <div style={{
          background: (isConsulting && colorNote) || course?.instructor?.color
            ? `linear-gradient(135deg, ${instColor}cc, ${accent}33)`
            : "var(--sc-raised)",
          borderBottom: `2px solid ${accent}`,
          padding: "20px 20px 16px",
        }}>
          <div className="flex items-start justify-between">
            <div>
              {/* 교실 · 요일 */}
              <p className="font-bold mb-1" style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                {cell.classroomName} · {dayLabel}요일
              </p>
              {/* 과목 — 메인 타이틀 */}
              <h3 className="text-2xl font-black" style={{ color: "#ffffff" }}>
                {isConsulting
                  ? (studentNote || "상담")
                  : (course?.subject ?? cell.courseName ?? "수업")}
              </h3>
              {/* 상담: 선생님 표시 / 수업: 강사 표시 */}
              {isConsulting ? (
                teacherNote ? (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: colorNote || "#888" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>
                      {teacherNote}T · 상담
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>상담</span>
                )
              ) : (
                (course?.instructor?.name ?? cell.teacherName) && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: course?.instructor?.color ?? "#888",
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>
                      {course?.instructor?.name ?? cell.teacherName}
                    </span>
                  </div>
                )
              )}
              {/* 시간 */}
              {cell.startTime && (
                <p className="font-semibold mt-1" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                  {cell.startTime} ~ {cell.endTime}
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-xl hover:opacity-60 mt-0.5"
                    style={{ color: "rgba(255,255,255,0.5)" }}>×</button>
          </div>
        </div>

        {/* 바디 */}
        <div style={{
          background: "var(--sc-surface)",
          padding:    "20px",
          overflowY:  "auto",
          maxHeight:  "calc(88vh - 120px)",
        }}>
          {loading ? (
            <div className="text-center py-8" style={{ color: "var(--sc-dim)", fontSize: 13 }}>
              불러오는 중...
            </div>
          ) : (
            <>
              {/* 상담 학생 이름 */}
              {isConsulting && studentNote && (
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                     style={{ color: "var(--sc-dim)" }}>상담 학생</p>
                  <div style={{
                    display:      "inline-block",
                    padding:      "5px 14px",
                    borderRadius: 20,
                    fontSize:     13,
                    fontWeight:   700,
                    background:   "var(--sc-raised)",
                    color:        "var(--sc-white)",
                    border:       `1px solid ${accent}55`,
                  }}>
                    {studentNote}
                  </div>
                </div>
              )}

              {/* 수강 학생 */}
              {course && (
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                     style={{ color: "var(--sc-dim)" }}>
                    수강 학생 {course.enrolledNames.length > 0 && `(${course.enrolledNames.length}명)`}
                  </p>
                  {course.enrolledNames.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--sc-dim)" }}>등록된 학생 없음</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {course.enrolledNames.map((name, i) => (
                        <div key={i}
                          style={{
                            padding:      "4px 10px",
                            borderRadius: 20,
                            fontSize:     12,
                            fontWeight:   600,
                            background:   "var(--sc-raised)",
                            color:        "var(--sc-white)",
                            border:       "1px solid var(--sc-border)",
                          }}>
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 메모 */}
              {course?.memo && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                     style={{ color: "var(--sc-dim)" }}>메모</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap"
                     style={{ color: "var(--sc-white)", opacity: 0.85 }}>
                    {course.memo}
                  </p>
                </div>
              )}

              {/* 구분선 */}
              <div style={{ height: 1, background: "var(--sc-border)", marginBottom: 16 }} />

              {/* 수정 / 삭제 */}
              {!showDelete ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { onEdit(cell!); }}
                    className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                    style={{
                      background: "var(--sc-raised)",
                      color:      "var(--sc-white)",
                      border:     `1px solid ${accent}55`,
                    }}>
                    ✏️ 수정
                  </button>
                  <button onClick={() => setShowDelete(true)}
                    className="py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                    일정 삭제
                  </button>
                </div>
              ) : cell?.isOverride ? (
                /* ── 임시 일정(override): 단순 삭제 UI ───────────── */
                <div className="space-y-3">
                  <div style={{
                    padding: "10px 14px", borderRadius: 10,
                    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                    fontSize: 12, color: "#f87171", fontWeight: 600,
                  }}>
                    이 일정은 임시 일정입니다. 삭제하면 완전히 제거됩니다.
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => setShowDelete(false)}
                      className="py-2.5 rounded-xl text-sm font-bold"
                      style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                      취소
                    </button>
                    <button onClick={submitDelete}
                      className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{
                        background: "rgba(239,68,68,0.2)",
                        color:      "#f87171",
                        border:     "1px solid rgba(239,68,68,0.4)",
                      }}>
                      삭제
                    </button>
                  </div>
                </div>
              ) : (
                /* ── 고정 일정: 임시 / 고정 삭제 선택 ───────────── */
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest"
                     style={{ color: "var(--sc-dim)" }}>삭제 유형</p>

                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { type: "temporary" as DeleteType, label: "임시 삭제", sub: "이 기간만 취소" },
                      { type: "permanent" as DeleteType, label: "고정 삭제", sub: "오늘부터 완전 삭제" },
                    ]).map(({ type, label, sub }) => (
                      <button key={type} onClick={() => setDeleteType(type)}
                        className="py-3 rounded-xl text-sm font-bold transition-all flex flex-col items-center gap-0.5"
                        style={{
                          background: deleteType === type
                            ? (type === "permanent" ? "rgba(239,68,68,0.15)" : "var(--sc-raised)")
                            : "var(--sc-raised)",
                          color: deleteType === type
                            ? (type === "permanent" ? "#f87171" : "var(--sc-white)")
                            : "var(--sc-dim)",
                          border: `1px solid ${deleteType === type
                            ? (type === "permanent" ? "rgba(239,68,68,0.4)" : "var(--sc-green)")
                            : "var(--sc-border)"}`,
                          transform: deleteType === type ? "scale(1.02)" : "scale(1)",
                        }}>
                        {label}
                        <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>{sub}</span>
                      </button>
                    ))}
                  </div>

                  {deleteType === "temporary" && (
                    <TempScopeSelector scope={tempScope} setScope={setTempScope} weeks={weeks} setWeeks={setWeeks} />
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => setShowDelete(false)}
                      className="py-2.5 rounded-xl text-sm font-bold"
                      style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                      취소
                    </button>
                    <button onClick={submitDelete}
                      className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{
                        background: deleteType === "permanent" ? "rgba(239,68,68,0.2)" : "var(--sc-green)",
                        color:      deleteType === "permanent" ? "#f87171"             : "var(--sc-bg)",
                        border:     deleteType === "permanent" ? "1px solid rgba(239,68,68,0.4)" : "none",
                      }}>
                      {deleteType === "permanent" ? "고정 삭제" : "임시 삭제"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
