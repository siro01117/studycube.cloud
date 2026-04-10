"use client";

import { useState, useEffect, useRef } from "react";

// ── 타입 ──────────────────────────────────────────────────────
export interface Teacher {
  id:    string;
  name:  string;
  color: string;   // hex bg color
}

export interface Student {
  id:     string;
  name:   string;
  school?: string;
  grade?: string;
}

export interface CourseCreateData {
  name:         string;
  subject?:     string;
  teacherId?:   string;
  studentIds:   string[];
  accentColor:  string;
}

interface Props {
  teachers:     Teacher[];
  students:     Student[];
  initialName?: string;
  onClose:      () => void;
  onCreate:     (data: CourseCreateData) => Promise<{ id: string; name: string } | null>;
}

// ── 색상 팔레트 ───────────────────────────────────────────────
const ACCENT_PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#00e875", "#a3e635",
];

// ── 교사 검색 드롭다운 ────────────────────────────────────────
function TeacherSelect({ teachers, value, onChange }: {
  teachers: Teacher[];
  value:    Teacher | null;
  onChange: (t: Teacher | null) => void;
}) {
  const [query, setQuery]   = useState("");
  const [open,  setOpen]    = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const filtered = teachers.filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase())
  );

  if (value) return (
    <div className="sc-input flex items-center gap-2.5" style={{ padding: "10px 12px" }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: value.color, flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.2)",
      }} />
      <span className="text-sm font-bold flex-1" style={{ color: "var(--sc-white)" }}>
        {value.name}
      </span>
      <button onClick={() => { onChange(null); setQuery(""); }}
              className="hover:opacity-60" style={{ color: "var(--sc-dim)" }}>×</button>
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="선생님 검색..."
        className="sc-input text-sm w-full"
        style={{ padding: "10px 12px" }}
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "var(--sc-surface)", border: "1px solid var(--sc-border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          maxHeight: 160, overflowY: "auto",
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--sc-dim)" }}>
              검색 결과 없음
            </div>
          )}
          {filtered.map((t) => (
            <button key={t.id}
              onClick={() => { onChange(t); setOpen(false); setQuery(""); }}
              className="w-full text-left flex items-center gap-2.5"
              style={{ padding: "9px 14px", display: "flex" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sc-raised)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: t.color, flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sc-white)" }}>
                {t.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 학생 멀티 선택 ────────────────────────────────────────────
function StudentMultiSelect({ students, selected, onToggle }: {
  students: Student[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = students.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="학생 검색..."
        className="sc-input text-sm w-full mb-2"
        style={{ padding: "8px 12px" }}
      />
      <div style={{
        maxHeight: 140, overflowY: "auto",
        border: "1px solid var(--sc-border)", borderRadius: 10,
        background: "var(--sc-raised)",
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--sc-dim)" }}>
            {query ? "검색 결과 없음" : "등록된 학생 없음"}
          </div>
        ) : (
          filtered.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button key={s.id}
                onClick={() => onToggle(s.id)}
                className="w-full text-left flex items-center gap-2.5 transition-colors"
                style={{
                  padding:    "8px 12px",
                  display:    "flex",
                  background: on ? "var(--card-spot)" : "transparent",
                  borderBottom: "1px solid var(--sc-border)",
                }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
              >
                {/* 체크박스 */}
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: `1.5px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                  background: on ? "var(--sc-green)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  {on && (
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.5 6L8 1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-white)" }}>{s.name}</p>
                  {(s.school || s.grade) && (
                    <p style={{ fontSize: 10, color: "var(--sc-dim)" }}>
                      {[s.school, s.grade].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
      {selected.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--sc-green)", marginTop: 6, fontWeight: 700 }}>
          {selected.length}명 선택됨
        </p>
      )}
    </div>
  );
}

// ── 메인 모달 ─────────────────────────────────────────────────
export default function CourseCreateModal({
  teachers, students, initialName = "", onClose, onCreate,
}: Props) {
  const [name,          setName]         = useState(initialName);
  const [subject,       setSubject]      = useState("");
  const [teacher,       setTeacher]      = useState<Teacher | null>(null);
  const [selectedStuds, setSelectedStuds] = useState<string[]>([]);
  const [accentColor,   setAccentColor]  = useState(ACCENT_PALETTE[0]);
  const [saving,        setSaving]       = useState(false);
  const [error,         setError]        = useState("");

  function toggleStudent(id: string) {
    setSelectedStuds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function handleCreate() {
    if (!name.trim()) { setError("수업 이름을 입력하세요."); return; }
    setSaving(true);
    setError("");
    const result = await onCreate({
      name:        name.trim(),
      subject:     subject.trim() || undefined,
      teacherId:   teacher?.id,
      studentIds:  selectedStuds,
      accentColor,
    });
    setSaving(false);
    if (!result) setError("저장 중 오류가 발생했습니다.");
  }

  return (
    <>
      <div className="fixed inset-0 z-50"
           style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
           onClick={onClose} />

      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-md rounded-2xl p-6 shadow-2xl animate-scale-in"
           style={{
             background:       "var(--sc-surface)",
             border:           "1px solid var(--sc-border)",
             animationFillMode:"forwards",
             maxHeight:        "90vh",
             overflowY:        "auto",
           }}
           onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1"
               style={{ color: "var(--sc-dim)" }}>수업 등록</p>
            <h3 className="font-black text-lg" style={{ color: "var(--sc-white)" }}>새 수업 만들기</h3>
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60"
                  style={{ color: "var(--sc-dim)" }}>×</button>
        </div>

        <div className="space-y-4 mb-5">
          {/* 수업 이름 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
               style={{ color: "var(--sc-dim)" }}>수업 이름 *</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) 수학 심화반"
              className="sc-input text-sm w-full"
              style={{ padding: "10px 12px" }}
              autoFocus
            />
          </div>

          {/* 과목 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
               style={{ color: "var(--sc-dim)" }}>과목</p>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="예) 수학, 영어, 과학..."
              className="sc-input text-sm w-full"
              style={{ padding: "10px 12px" }}
            />
          </div>

          {/* 강조색 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
               style={{ color: "var(--sc-dim)" }}>수업 강조색</p>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  style={{
                    width:      28,
                    height:     28,
                    borderRadius: "50%",
                    background: c,
                    border:     accentColor === c
                      ? "2.5px solid var(--sc-white)"
                      : "2.5px solid transparent",
                    outline:    accentColor === c ? `2px solid ${c}` : "none",
                    outlineOffset: 2,
                    transition: "all 0.15s",
                    transform:  accentColor === c ? "scale(1.2)" : "scale(1)",
                    cursor:     "pointer",
                  }}
                />
              ))}
            </div>
            {/* 미리보기 */}
            <div className="mt-2 px-3 py-2 rounded-lg flex items-center gap-2"
                 style={{ background: "var(--sc-raised)", borderLeft: `3px solid ${accentColor}` }}>
              <span style={{ fontSize: 11, color: "var(--sc-dim)" }}>미리보기 —</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sc-white)" }}>
                {name || "수업 이름"}
              </span>
            </div>
          </div>

          {/* 담당 선생님 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
               style={{ color: "var(--sc-dim)" }}>담당 선생님</p>
            <TeacherSelect teachers={teachers} value={teacher} onChange={setTeacher} />
          </div>

          {/* 수강 학생 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
               style={{ color: "var(--sc-dim)" }}>수강 학생</p>
            <StudentMultiSelect
              students={students}
              selected={selectedStuds}
              onToggle={toggleStudent}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm mb-3 text-center" style={{ color: "#f87171" }}>{error}</p>
        )}

        {/* 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose}
            className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
            취소
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "var(--sc-green)", color: "var(--sc-bg)", opacity: saving ? 0.6 : 1 }}>
            {saving ? "저장 중..." : "수업 만들기"}
          </button>
        </div>
      </div>
    </>
  );
}
