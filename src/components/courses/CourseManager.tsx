"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import InstructorManager, { Instructor } from "./InstructorManager";
import ThemeToggle from "@/components/ui/ThemeToggle";

// ── 타입 ──────────────────────────────────────────────────────
interface CourseRow {
  id:            string;
  subject?:      string;
  accent_color:  string;
  instructor?:   Instructor;
  enrolledNames: string[];
  memo?:         string;
}

// ── 색상 팔레트 ───────────────────────────────────────────────
const ACCENT_PALETTE = [
  "#6366f1","#8b5cf6","#ec4899","#f43f5e",
  "#f97316","#eab308","#22c55e","#14b8a6",
  "#06b6d4","#3b82f6","#00e875","#a3e635",
];

// ── 아이콘 ─────────────────────────────────────────────────────
const ip = {
  width:16, height:16, viewBox:"0 0 24 24", fill:"none",
  stroke:"currentColor", strokeWidth:1.75,
  strokeLinecap:"round" as const, strokeLinejoin:"round" as const,
};
const PencilIcon = () => <svg {...ip}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const TrashIcon  = () => <svg {...ip}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>;
const HomeIcon   = () => <svg {...ip}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const PlusIcon   = () => <svg {...ip}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const UserIcon   = () => <svg {...ip}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

// ── 학생 이름 직접 입력 (추가 방식) ──────────────────────────
function NameListInput({ names, onChange }: { names: string[]; onChange: (n: string[]) => void }) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v) return;
    onChange([...names, v]);
    setInput("");
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); }}}
          placeholder="학생 이름 입력 후 추가..."
          className="sc-input text-sm flex-1"
          style={{ padding: "8px 12px" }}
        />
        <button
          onClick={add}
          className="px-4 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{ background: "var(--sc-green)", color: "var(--sc-bg)", flexShrink: 0 }}
        >
          추가
        </button>
      </div>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {names.map((name, i) => (
            <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)", color: "var(--sc-white)" }}>
              {name}
              <button
                onClick={() => onChange(names.filter((_, j) => j !== i))}
                className="hover:opacity-60 ml-0.5"
                style={{ color: "var(--sc-dim)", fontSize: 14, lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 11, color: "var(--sc-border)", marginTop: 4 }}>아직 추가된 학생 없음</p>
      )}
      {names.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--sc-green)", marginTop: 6, fontWeight: 700 }}>
          {names.length}명
        </p>
      )}
    </div>
  );
}

// ── 강사 선택 드롭다운 ────────────────────────────────────────
function InstructorSelect({ instructors, value, onChange }: {
  instructors: Instructor[];
  value:       Instructor | null;
  onChange:    (t: Instructor | null) => void;
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

  const filtered = instructors.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  if (value) return (
    <div className="sc-input flex items-center gap-2.5" style={{ padding: "10px 12px" }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: value.color, flexShrink: 0 }} />
      <span className="text-sm font-bold flex-1" style={{ color: "var(--sc-white)" }}>{value.name}</span>
      {value.subjects.length > 0 && (
        <span style={{ fontSize: 10, color: "var(--sc-dim)" }}>{value.subjects.join(", ")}</span>
      )}
      <button onClick={() => { onChange(null); setQuery(""); }} style={{ color: "var(--sc-dim)" }}>×</button>
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="선생님 검색..." className="sc-input text-sm w-full" style={{ padding: "10px 12px" }} />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--sc-surface)", border: "1px solid var(--sc-border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxHeight: 180, overflowY: "auto",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--sc-dim)" }}>검색 결과 없음</div>
          ) : filtered.map((t) => (
            <button key={t.id} onClick={() => { onChange(t); setOpen(false); setQuery(""); }}
              className="w-full text-left flex items-center gap-2.5"
              style={{ padding: "9px 14px", display: "flex" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sc-raised)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sc-white)" }}>{t.name}</span>
                {t.subjects.length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--sc-dim)", marginLeft: 6 }}>{t.subjects.join(", ")}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 수업 폼 모달 (생성/수정) ──────────────────────────────────
function CourseFormModal({ initial, instructors, onClose, onSave }: {
  initial?:    CourseRow;
  instructors: Instructor[];
  onClose:     () => void;
  onSave:      (data: {
    subject?: string; instructorId?: string;
    enrolledNames: string[]; accentColor: string; memo?: string;
  }) => Promise<void>;
}) {
  const isEdit = !!initial;
  const [subject,       setSubject]      = useState(initial?.subject      ?? "");
  const [instructor,    setInstructor]   = useState<Instructor | null>(initial?.instructor ?? null);
  const [enrolledNames, setEnrolledNames]= useState<string[]>(initial?.enrolledNames ?? []);
  const [accentColor,   setAccentColor]  = useState(initial?.accent_color ?? ACCENT_PALETTE[0]);
  const [memo,          setMemo]         = useState(initial?.memo         ?? "");
  const [saving,        setSaving]       = useState(false);
  const [error,         setError]        = useState("");

  async function handleSave() {
    if (!subject.trim() && !instructor) { setError("과목 또는 선생님 중 하나는 입력하세요."); return; }
    setSaving(true); setError("");
    await onSave({
      subject: subject.trim() || undefined,
      instructorId: instructor?.id,
      enrolledNames,
      accentColor,
      memo: memo.trim() || undefined,
    });
    setSaving(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-50"
           style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
           onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-md rounded-2xl p-6 shadow-2xl"
           style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", maxHeight: "90vh", overflowY: "auto" }}
           onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--sc-dim)" }}>
              {isEdit ? "수업 수정" : "수업 등록"}
            </p>
            <h3 className="font-black text-lg" style={{ color: "var(--sc-white)" }}>
              {isEdit ? "수업 정보 수정" : "새 수업 만들기"}
            </h3>
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60" style={{ color: "var(--sc-dim)" }}>×</button>
        </div>

        <div className="space-y-4 mb-5">
          {/* 과목 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>과목</p>
            <input value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="예) 수학, 영어, 과학..."
              className="sc-input text-sm w-full" style={{ padding: "10px 12px" }} autoFocus />
          </div>

          {/* 강조색 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--sc-dim)" }}>수업 강조색</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {ACCENT_PALETTE.map((c) => (
                <button key={c} onClick={() => setAccentColor(c)} style={{
                  width: 26, height: 26, borderRadius: "50%", background: c,
                  border: accentColor === c ? "2.5px solid var(--sc-white)" : "2.5px solid transparent",
                  outline: accentColor === c ? `2px solid ${c}` : "none", outlineOffset: 2,
                  transform: accentColor === c ? "scale(1.2)" : "scale(1)", transition: "all 0.15s",
                }} />
              ))}
            </div>
            <div className="px-3 py-2 rounded-lg flex items-center gap-2"
                 style={{ background: "var(--sc-raised)", borderLeft: `3px solid ${accentColor}` }}>
              <span style={{ fontSize: 11, color: "var(--sc-dim)" }}>미리보기</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sc-white)" }}>
                {subject || instructor?.name || "과목/선생님"}
              </span>
            </div>
          </div>

          {/* 담당 선생님 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>담당 선생님</p>
            {instructors.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--sc-dim)" }}>
                선생님을 먼저 등록해주세요. (선생님 관리 버튼)
              </p>
            ) : (
              <InstructorSelect instructors={instructors} value={instructor} onChange={setInstructor} />
            )}
          </div>

          {/* 수강 학생 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>수강 학생</p>
            <NameListInput names={enrolledNames} onChange={setEnrolledNames} />
          </div>

          {/* 메모 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>메모</p>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="수업 관련 메모, 특이사항..."
              rows={3}
              className="sc-input text-sm w-full resize-none"
              style={{ padding: "10px 12px" }}
            />
          </div>
        </div>

        {error && <p className="text-sm mb-3 text-center" style={{ color: "#f87171" }}>{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>취소</button>
          <button onClick={handleSave} disabled={saving}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "var(--sc-green)", color: "var(--sc-bg)", opacity: saving ? 0.6 : 1 }}>
            {saving ? "저장 중..." : (isEdit ? "수정 완료" : "수업 만들기")}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 삭제 확인 모달 ────────────────────────────────────────────
function DeleteConfirm({ course, onCancel, onConfirm }: {
  course: CourseRow; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-50"
           style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
           onClick={onCancel} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-sm rounded-2xl p-6 shadow-2xl"
           style={{ background: "var(--sc-surface)", border: "1px solid rgba(239,68,68,0.3)" }}
           onClick={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-2" style={{ color: "var(--sc-white)" }}>수업 삭제</h3>
        <p className="text-sm mb-1" style={{ color: "var(--sc-dim)" }}>
          <span style={{ color: "var(--sc-white)", fontWeight: 700 }}>
            "{course.subject || course.instructor?.name || "이 수업"}"
          </span> 수업을 삭제하시겠어요?
        </p>
        <p className="text-xs mb-5" style={{ color: "rgba(239,68,68,0.8)" }}>
          관련 일정 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>취소</button>
          <button onClick={onConfirm} className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.4)" }}>삭제</button>
        </div>
      </div>
    </>
  );
}

// ── 수업 카드 ─────────────────────────────────────────────────
function CourseCard({ course, onEdit, onDelete }: {
  course: CourseRow; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2.5 relative group"
         style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)",
                  borderLeft: `3px solid ${course.accent_color}` }}>

      {/* 과목 + 선생님 (동일 강조) */}
      <div className="flex flex-col gap-1 min-w-0">
        {/* 과목 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: course.accent_color, flexShrink: 0 }} />
          <p className="font-bold text-sm truncate" style={{ color: "var(--sc-white)" }}>
            {course.subject || "(과목 미지정)"}
          </p>
        </div>
        {/* 선생님 */}
        {course.instructor ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: course.instructor.color, flexShrink: 0 }} />
            <p className="font-bold text-sm truncate" style={{ color: "var(--sc-white)" }}>
              {course.instructor.name}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--sc-border)", flexShrink: 0 }} />
            <p className="text-xs" style={{ color: "var(--sc-border)" }}>선생님 미지정</p>
          </div>
        )}
      </div>

      {/* 메모 */}
      {course.memo && (
        <p className="text-xs leading-relaxed" style={{
          color: "var(--sc-dim)",
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const, overflow: "hidden",
        }}>{course.memo}</p>
      )}

      {/* 수강생 — 강조 */}
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
             style={{ background: `${course.accent_color}18`, border: `1px solid ${course.accent_color}30` }}>
          <UserIcon />
          {course.enrolledNames.length > 0 ? (
            <div>
              <span style={{ fontSize: 12, fontWeight: 800, color: course.accent_color }}>
                {course.enrolledNames.length}명
              </span>
              <span style={{ fontSize: 10, color: "var(--sc-dim)", marginLeft: 4 }}>
                {course.enrolledNames.slice(0, 3).join(", ")}
                {course.enrolledNames.length > 3 && ` 외 ${course.enrolledNames.length - 3}명`}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: "var(--sc-dim)" }}>학생 없음</span>
          )}
        </div>

        {/* 액션 버튼 — hover 시 노출 */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
            <PencilIcon />
          </button>
          <button onClick={onDelete}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 필터 탭 ───────────────────────────────────────────────────
type FilterMode = "all" | "subject" | "instructor";

// ── 메인 컴포넌트 ─────────────────────────────────────────────
// ── 세션스토리지 필터 유틸 ──────────────────────────────────────
const COURSE_FILTER_KEY = "sc_course_filter";
function loadCourseFilter() {
  try { return JSON.parse(sessionStorage.getItem(COURSE_FILTER_KEY) ?? "{}"); } catch { return {}; }
}
function saveCourseFilter(patch: Record<string, unknown>) {
  try {
    const cur = loadCourseFilter();
    sessionStorage.setItem(COURSE_FILTER_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* ignore */ }
}

export default function CourseManager() {
  const supabase = createClient();

  const [courses,     setCourses]     = useState<CourseRow[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading,     setLoading]     = useState(true);

  const [createOpen,        setCreateOpen]        = useState(false);
  const [editTarget,        setEditTarget]        = useState<CourseRow | null>(null);
  const [deleteTarget,      setDeleteTarget]      = useState<CourseRow | null>(null);
  const [showInstructorMgr, setShowInstructorMgr] = useState(false);
  const [search,            setSearch]            = useState("");
  const [filterMode,        setFilterModeRaw]     = useState<FilterMode>("all");
  const [filterValue,       setFilterValueRaw]    = useState<string>("all");

  // sessionStorage 복원 (hydration 오류 방지: useEffect 내에서만 읽기)
  useEffect(() => {
    const savedF = loadCourseFilter();
    if (savedF.filterMode)  setFilterModeRaw(savedF.filterMode as FilterMode);
    if (savedF.filterValue) setFilterValueRaw(savedF.filterValue);
  }, []);

  function setFilterMode(m: FilterMode) { setFilterModeRaw(m); saveCourseFilter({ filterMode: m }); }
  function setFilterValue(v: string)    { setFilterValueRaw(v); saveCourseFilter({ filterValue: v }); }

  // ── 강사 목록 로드 ───────────────────────────────────────────
  const loadInstructors = useCallback(async () => {
    const { data } = await supabase.from("instructors").select("id, name, subjects, color, memo").order("name");
    setInstructors((data ?? []) as Instructor[]);
  }, [supabase]);

  // ── 수업 목록 로드 ───────────────────────────────────────────
  const loadCourses = useCallback(async () => {
    const { data } = await supabase
      .from("courses")
      .select("id, subject, accent_color, enrolled_names, memo, instructors ( id, name, subjects, color, memo )")
      .order("subject");
    if (!data) return;
    setCourses(data.map((c: any) => ({
      id:            c.id,
      subject:       c.subject,
      accent_color:  c.accent_color ?? "#6366f1",
      instructor:    c.instructors ?? undefined,
      enrolledNames: c.enrolled_names ?? [],
      memo:          c.memo,
    })));
  }, [supabase]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCourses(), loadInstructors()]).finally(() => setLoading(false));
  }, [loadCourses, loadInstructors]);

  // ── 자동 name 생성 헬퍼 ──────────────────────────────────────
  function buildAutoName(subject?: string, instructorId?: string) {
    const inst = instructors.find((i) => i.id === instructorId);
    return [subject, inst?.name].filter(Boolean).join(" · ") || "수업";
  }

  // ── 생성 ─────────────────────────────────────────────────────
  async function handleCreate(formData: any) {
    const { error } = await supabase.from("courses").insert({
      name:           buildAutoName(formData.subject, formData.instructorId),
      subject:        formData.subject ?? null,
      instructor_id:  formData.instructorId ?? null,
      accent_color:   formData.accentColor,
      enrolled_names: formData.enrolledNames,
      memo:           formData.memo ?? null,
    });
    if (error) {
      alert(
        `수업 저장 실패: ${error.message}\n\n` +
        `Supabase SQL Editor에서 아래 마이그레이션을 순서대로 실행했는지 확인하세요:\n` +
        `1. add_instructors.sql\n2. add_course_memo.sql`
      );
      return;
    }
    setCreateOpen(false);
    await loadCourses();
  }

  // ── 수정 ─────────────────────────────────────────────────────
  async function handleEdit(formData: any) {
    if (!editTarget) return;
    const { error } = await supabase.from("courses").update({
      name:           buildAutoName(formData.subject, formData.instructorId),
      subject:        formData.subject ?? null,
      instructor_id:  formData.instructorId ?? null,
      accent_color:   formData.accentColor,
      enrolled_names: formData.enrolledNames,
      memo:           formData.memo ?? null,
    }).eq("id", editTarget.id);
    if (error) {
      alert(`수업 수정 실패: ${error.message}`);
      return;
    }
    setEditTarget(null);
    await loadCourses();
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    await supabase.from("courses").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    await loadCourses();
  }

  // 검색 필터
  const searched = courses.filter((c) =>
    (c.subject ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.instructor?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.memo ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // 탭 필터 (선생님별 / 과목별 / 전체)
  const filtered = searched.filter((c) => {
    if (filterMode === "all" || filterValue === "all") return true;
    if (filterMode === "instructor") return (c.instructor?.id ?? "none") === filterValue;
    if (filterMode === "subject")    return (c.subject ?? "기타") === filterValue;
    return true;
  });

  // 고유 과목 목록 (필터 탭용)
  const uniqueSubjects = Array.from(new Set(courses.map((c) => c.subject ?? "기타"))).sort();
  const uniqueInstructors = instructors.filter((i) =>
    courses.some((c) => c.instructor?.id === i.id)
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--sc-bg)" }}>
      {/* 헤더 */}
      <div className="sticky top-0 z-30 px-8 pt-6 pb-4"
           style={{ background: "var(--sc-bg)", borderBottom: "1px solid var(--sc-border)", backdropFilter: "blur(12px)" }}>
        {/* 브레드크럼 + 테마 토글 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <Link href="/portal"
              className="flex items-center gap-1.5 text-xs font-semibold transition-all hover:opacity-100 w-fit"
              style={{ color: "var(--sc-dim)", opacity: 0.6 }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}>
              <HomeIcon /> 홈
            </Link>
            <span style={{ color: "var(--sc-border)" }}>·</span>
            <Link href="/manage/classroom-schedule"
              className="text-xs font-semibold transition-all hover:opacity-100"
              style={{ color: "var(--sc-dim)", opacity: 0.6 }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}>
              교실 시간표
            </Link>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--sc-dim)" }}>Management</p>
            <h1 className="text-2xl font-black" style={{ color: "var(--sc-white)" }}>수업 관리</h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 선생님 관리 버튼 */}
            <button
              onClick={() => setShowInstructorMgr(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
              style={{ background: "var(--sc-raised)", color: "var(--sc-white)", border: "1px solid var(--sc-border)" }}
            >
              <UserIcon /> 선생님 관리
            </button>
            {/* 검색 */}
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="수업 검색..." className="sc-input text-sm"
              style={{ padding: "8px 14px", width: 180 }} />
            {/* 새 수업 */}
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
              style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
              <PlusIcon /> 새 수업
            </button>
          </div>
        </div>
      </div>

      {/* 필터 탭 바 */}
      {!loading && courses.length > 0 && (
        <div className="px-8 pt-4 pb-2 max-w-screen-lg mx-auto">
          {/* 모드 선택 */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {([
              { mode: "all"        as FilterMode, label: "전체" },
              { mode: "instructor" as FilterMode, label: "선생님별" },
              { mode: "subject"    as FilterMode, label: "과목별"  },
            ]).map(({ mode, label }) => (
              <button key={mode} onClick={() => { setFilterMode(mode); setFilterValue("all"); }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: filterMode === mode ? "var(--sc-green)" : "var(--sc-raised)",
                  color:      filterMode === mode ? "var(--sc-bg)"    : "var(--sc-dim)",
                  border:     `1px solid ${filterMode === mode ? "var(--sc-green)" : "var(--sc-border)"}`,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* 선생님 필터 칩 */}
          {filterMode === "instructor" && uniqueInstructors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setFilterValue("all")}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: filterValue === "all" ? "var(--sc-surface)" : "transparent",
                  color:      filterValue === "all" ? "var(--sc-white)"   : "var(--sc-dim)",
                  border:     `1px solid ${filterValue === "all" ? "var(--sc-white)" : "var(--sc-border)"}`,
                }}>
                전체
              </button>
              {uniqueInstructors.map((inst) => (
                <button key={inst.id} onClick={() => setFilterValue(inst.id)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
                  style={{
                    background: filterValue === inst.id ? `${inst.color}22` : "transparent",
                    color:      filterValue === inst.id ? "var(--sc-white)" : "var(--sc-dim)",
                    border:     `1px solid ${filterValue === inst.id ? inst.color : "var(--sc-border)"}`,
                  }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: inst.color }} />
                  {inst.name}
                </button>
              ))}
            </div>
          )}

          {/* 과목 필터 칩 */}
          {filterMode === "subject" && uniqueSubjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setFilterValue("all")}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: filterValue === "all" ? "var(--sc-surface)" : "transparent",
                  color:      filterValue === "all" ? "var(--sc-white)"   : "var(--sc-dim)",
                  border:     `1px solid ${filterValue === "all" ? "var(--sc-white)" : "var(--sc-border)"}`,
                }}>
                전체
              </button>
              {uniqueSubjects.map((subj) => (
                <button key={subj} onClick={() => setFilterValue(subj)}
                  className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                  style={{
                    background: filterValue === subj ? "var(--sc-surface)" : "transparent",
                    color:      filterValue === subj ? "var(--sc-white)"   : "var(--sc-dim)",
                    border:     `1px solid ${filterValue === subj ? "var(--sc-white)" : "var(--sc-border)"}`,
                  }}>
                  {subj}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 본문 */}
      <div className="px-8 py-4 max-w-screen-lg mx-auto">
        {loading ? (
          <div className="text-center py-20" style={{ color: "var(--sc-dim)" }}>불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p style={{ color: "var(--sc-dim)", fontSize: 14 }}>
              {search ? `"${search}" 검색 결과 없음` : "등록된 수업이 없습니다."}
            </p>
            {!search && (
              <button onClick={() => setCreateOpen(true)}
                className="mt-4 px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
                첫 수업 만들기
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs mb-4 font-semibold" style={{ color: "var(--sc-dim)" }}>
              총 {filtered.length}개 수업
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onEdit={() => setEditTarget(c)}
                  onDelete={() => setDeleteTarget(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* 생성 모달 */}
      {createOpen && (
        <CourseFormModal instructors={instructors} onClose={() => setCreateOpen(false)} onSave={handleCreate} />
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <CourseFormModal initial={editTarget} instructors={instructors} onClose={() => setEditTarget(null)} onSave={handleEdit} />
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <DeleteConfirm course={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}

      {/* 선생님 관리 */}
      {showInstructorMgr && (
        <InstructorManager
          onClose={() => setShowInstructorMgr(false)}
          onUpdated={loadInstructors}
        />
      )}
    </div>
  );
}
