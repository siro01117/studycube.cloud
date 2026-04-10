"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Classroom {
  id:          string;
  name:        string;
  floor?:      number;
  description?: string;
}

interface Props {
  classrooms: Classroom[];
  onClose:    () => void;
  onRefresh:  () => void;
}

const FLOORS = [4, 5];  // 4층, 5층만

const emptyForm = { name: "", floor: 5, description: "" };

export default function ClassroomManagerModal({ classrooms, onClose, onRefresh }: Props) {
  const supabase = createClient();

  const [list,       setList]       = useState<Classroom[]>(classrooms);
  const [form,       setForm]       = useState(emptyForm);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── 추가 ──────────────────────────────────────────────────
  async function handleAdd() {
    if (!form.name.trim()) { setError("교실 이름을 입력해 주세요."); return; }
    setLoading(true); setError(null);

    const { data, error } = await supabase
      .from("classrooms")
      .insert({ name: form.name.trim(), floor: form.floor, description: form.description || null })
      .select()
      .single();

    if (error) { setError(error.message); setLoading(false); return; }
    setList((l) => [...l, data]);
    setForm(emptyForm);
    setLoading(false);
  }

  // ── 수정 시작 ─────────────────────────────────────────────
  function startEdit(c: Classroom) {
    setEditingId(c.id);
    setForm({ name: c.name, floor: c.floor ?? 4, description: c.description ?? "" });
    setError(null);
  }

  // ── 수정 저장 ─────────────────────────────────────────────
  async function handleUpdate() {
    if (!form.name.trim()) { setError("교실 이름을 입력해 주세요."); return; }
    setLoading(true); setError(null);

    const { error } = await supabase
      .from("classrooms")
      .update({ name: form.name.trim(), floor: form.floor, description: form.description || null })
      .eq("id", editingId!);

    if (error) { setError(error.message); setLoading(false); return; }
    setList((l) =>
      l.map((c) => c.id === editingId
        ? { ...c, name: form.name.trim(), floor: form.floor, description: form.description }
        : c
      )
    );
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
  }

  // ── 삭제 ──────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 교실을 삭제하시겠습니까?\n연결된 일정도 모두 삭제됩니다.`)) return;
    setLoading(true);

    const { error } = await supabase.from("classrooms").delete().eq("id", id);
    if (error) { setError(error.message); setLoading(false); return; }
    setList((l) => l.filter((c) => c.id !== id));
    setLoading(false);
  }

  const isEditing = !!editingId;

  return (
    <>
      {/* 백드롭 */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* 모달 */}
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                   w-full max-w-md rounded-2xl shadow-2xl animate-scale-in flex flex-col"
        style={{
          background:        "var(--sc-surface)",
          border:            "1px solid var(--sc-border)",
          animationFillMode: "forwards",
          maxHeight:         "80vh",
        }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4"
             style={{ borderBottom: "1px solid var(--sc-border)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest"
               style={{ color: "var(--sc-dim)" }}>Management</p>
            <h3 className="text-lg font-black mt-0.5" style={{ color: "var(--sc-white)" }}>
              교실 관리
            </h3>
          </div>
          <button onClick={onClose} className="text-2xl leading-none transition-opacity hover:opacity-60"
                  style={{ color: "var(--sc-dim)" }}>×</button>
        </div>

        {/* 교실 목록 */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: "var(--sc-dim)" }}>
              등록된 교실이 없습니다
            </p>
          )}
          {list.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* 층 뱃지 */}
                <span
                  className="text-[10px] font-black w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}
                >
                  {c.floor ?? "?"}F
                </span>
                {/* 이름 + 메모 한 줄 */}
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-bold flex-shrink-0" style={{ color: "var(--sc-white)" }}>
                    {c.name}
                  </p>
                  {c.description && (
                    <p className="text-[11px] truncate" style={{ color: "var(--sc-dim)" }}>
                      {c.description}
                    </p>
                  )}
                </div>
              </div>

              {/* 수정/삭제 버튼 */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => startEdit(c)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all duration-150"
                  style={{ color: "var(--sc-dim)", border: "1px solid var(--sc-border)", background: "var(--sc-surface)" }}
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(c.id, c.name)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all duration-150"
                  style={{ color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)" }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 추가/수정 폼 */}
        <div
          className="px-6 py-5"
          style={{ borderTop: "1px solid var(--sc-border)" }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3"
             style={{ color: "var(--sc-dim)" }}>
            {isEditing ? "교실 수정" : "새 교실 추가"}
          </p>

          {/* 이름 + 층 */}
          <div className="flex gap-2 mb-2">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="교실 이름 (예: 5-1)"
              onKeyDown={(e) => e.key === "Enter" && (isEditing ? handleUpdate() : handleAdd())}
              className="sc-input flex-1 text-sm"
              style={{ padding: "10px 14px" }}
            />
            {/* 층 선택 */}
            <select
              value={form.floor}
              onChange={(e) => setForm((f) => ({ ...f, floor: +e.target.value }))}
              className="sc-input text-sm"
              style={{ padding: "10px 10px", width: 80, flexShrink: 0 }}
            >
              {FLOORS.map((f) => (
                <option key={f} value={f}>{f}층</option>
              ))}
            </select>
          </div>

          {/* 설명 (선택) */}
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="메모 (선택 · 이름 옆에 표시됨)"
            className="sc-input text-sm mb-3 w-full"
            style={{ padding: "10px 14px", width: "100%" }}
          />

          {/* 에러 */}
          {error && (
            <p className="text-xs mb-2 px-3 py-2 rounded-lg"
               style={{ color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </p>
          )}

          {/* 버튼 */}
          <div className="flex gap-2">
            {isEditing && (
              <button
                onClick={() => { setEditingId(null); setForm(emptyForm); setError(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-200"
                style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}
              >
                취소
              </button>
            )}
            <button
              onClick={isEditing ? handleUpdate : handleAdd}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                         disabled:opacity-40"
              style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}
            >
              {loading ? "저장 중..." : isEditing ? "수정 저장" : "+ 교실 추가"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
