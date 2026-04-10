"use client";

import { useState, useTransition } from "react";
import { RoleRow } from "@/types";

// ── 서버 액션 ─────────────────────────────────────────────────────
import {
  createRole, updateRole as updateRoleAction, deleteRole as deleteRoleAction,
} from "@/app/admin/users/actions";

// ── 카테고리 / 모듈 정의 (PortalGrid 와 동일) ──────────────────────
export interface ModuleDef { key: string; name: string; }
export interface CategoryDef { id: string; label: string; modules: ModuleDef[]; }

export const ALL_CATEGORIES: CategoryDef[] = [
  {
    id: "admin",
    label: "관리자",
    modules: [
      { key: "users", name: "유저 관리" },
    ],
  },
  {
    id: "manager",
    label: "운영 관리",
    modules: [
      { key: "classroom-schedule", name: "교실 시간표" },
      { key: "attendance",         name: "출결 관리"   },
      { key: "lunch",              name: "도시락 관리" },
      { key: "courses",            name: "수업 관리"   },
    ],
  },
  {
    id: "student-manage",
    label: "학생 관리",
    modules: [
      { key: "students-register",    name: "학생 등록"   },
      { key: "students-schedule",    name: "학생 시간표" },
      { key: "students-assignments", name: "학생 과제"   },
    ],
  },
  {
    id: "user",
    label: "학생 전용",
    modules: [
      { key: "student-schedule",    name: "내 시간표"   },
      { key: "student-assignments", name: "내 과제표"   },
      { key: "student-lunch",       name: "도시락 신청" },
      { key: "student-enroll",      name: "수강 신청"   },
    ],
  },
];

const PRESET_COLORS = [
  "#00FF85","#5badff","#a78bfa","#f472b6","#fb923c",
  "#facc15","#34d399","#f87171","#94a3b8","#e2e8f0",
];

// ── 역할 폼 모달 ──────────────────────────────────────────────────
function RoleFormModal({
  initial, onClose, onSaved,
}: {
  initial?: RoleRow;
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const isEdit = !!initial;

  const [name,         setName]         = useState(initial?.name         ?? "");
  const [label,        setLabel]        = useState(initial?.label        ?? "");
  const [color,        setColor]        = useState(initial?.color        ?? "#6366f1");
  const [showInSignup, setShowInSignup] = useState(initial?.show_in_signup ?? true);
  const [catOrder,     setCatOrder]     = useState<string[]>(
    initial?.category_order ?? []
  );

  // permissions: { categoryId: Set<moduleKey> }
  const [perms, setPerms] = useState<Record<string, Set<string>>>(() => {
    const p = initial?.permissions ?? {};
    return Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c.id, new Set<string>(p[c.id] ?? [])])
    );
  });

  const [pending, startTrans] = useTransition();
  const [error,   setError]   = useState("");

  // 카테고리가 적어도 하나라도 체크 됐는지
  function isCatVisible(catId: string) {
    return (perms[catId]?.size ?? 0) > 0;
  }

  function toggleModule(catId: string, key: string) {
    setPerms((prev) => {
      const next  = { ...prev, [catId]: new Set(prev[catId]) };
      if (next[catId].has(key)) next[catId].delete(key);
      else next[catId].add(key);

      // 카테고리가 visible해지면 catOrder에 추가
      setCatOrder((ord) => {
        if (next[catId].size > 0 && !ord.includes(catId))
          return [...ord, catId];
        if (next[catId].size === 0)
          return ord.filter((c) => c !== catId);
        return ord;
      });
      return next;
    });
  }

  function toggleAllModules(catId: string) {
    const cat = ALL_CATEGORIES.find((c) => c.id === catId)!;
    const allOn = cat.modules.every((m) => perms[catId]?.has(m.key));
    setPerms((prev) => {
      const next = { ...prev, [catId]: allOn ? new Set<string>() : new Set(cat.modules.map((m) => m.key)) };
      setCatOrder((ord) => {
        if (next[catId].size > 0 && !ord.includes(catId)) return [...ord, catId];
        if (next[catId].size === 0) return ord.filter((c) => c !== catId);
        return ord;
      });
      return next;
    });
  }

  function moveCat(idx: number, dir: -1 | 1) {
    setCatOrder((prev) => {
      const arr = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return arr;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr;
    });
  }

  function handleSave() {
    if (!label.trim()) { setError("역할 이름을 입력하세요."); return; }
    if (!isEdit && !name.trim()) { setError("역할 키를 입력하세요."); return; }
    if (!isEdit && !/^[a-z0-9_-]+$/.test(name)) { setError("역할 키는 소문자, 숫자, -, _만 사용 가능합니다."); return; }

    const permissions: Record<string, string[]> = {};
    for (const [catId, keys] of Object.entries(perms)) {
      if (keys.size > 0) permissions[catId] = Array.from(keys);
    }

    setError("");
    startTrans(async () => {
      try {
        if (isEdit) {
          await updateRoleAction(initial!.id, { label: label.trim(), color, permissions, category_order: catOrder, show_in_signup: showInSignup });
        } else {
          await createRole({ name: name.trim(), label: label.trim(), color, permissions, category_order: catOrder, show_in_signup: showInSignup });
        }
        onSaved();
        onClose();
      } catch (e: any) { setError(e.message); }
    });
  }

  // 현재 catOrder 에 있는 visible 카테고리 (순서 표시용)
  const visibleCats = catOrder.filter((id) => isCatVisible(id));

  return (
    <>
      <div className="fixed inset-0 z-50"
           style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)" }}
           onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                      w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
           style={{ border: "1px solid var(--sc-border)", maxHeight: "90vh" }}
           onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between"
             style={{ background: "var(--sc-raised)", borderBottom: "1px solid var(--sc-border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--sc-dim)" }}>
              {isEdit ? "역할 수정" : "새 역할 추가"}
            </p>
            <h3 className="font-black text-lg" style={{ color: "var(--sc-white)" }}>
              {isEdit ? initial!.label : "역할 설정"}
            </h3>
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60" style={{ color: "var(--sc-dim)" }}>×</button>
        </div>

        {/* 바디 */}
        <div className="px-6 py-5 overflow-y-auto space-y-5"
             style={{ background: "var(--sc-surface)", maxHeight: "calc(90vh - 130px)" }}>

          {/* 역할 키 (신규만) */}
          {!isEdit && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>역할 키 *</p>
              <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="예: teacher, parent" className="sc-input w-full text-sm" />
              <p className="text-[10px] mt-1" style={{ color: "var(--sc-dim)" }}>소문자, 숫자, -, _ 만 허용 · 이후 변경 불가</p>
            </div>
          )}

          {/* 역할 이름 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--sc-dim)" }}>역할 이름 *</p>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="예: 선생님, 학부모" className="sc-input w-full text-sm" autoFocus={isEdit} />
          </div>

          {/* 색상 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--sc-dim)" }}>색상</p>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-all hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: 2,
                    transform: color === c ? "scale(1.15)" : "scale(1)",
                  }} />
              ))}
              <div className="flex items-center gap-1.5 ml-1">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-7 rounded cursor-pointer border-0"
                  style={{ background: "transparent" }} />
                <span className="text-xs font-mono" style={{ color: "var(--sc-dim)" }}>{color}</span>
              </div>
            </div>
          </div>

          {/* 회원가입 노출 */}
          <div className="flex items-center justify-between py-3 px-4 rounded-xl"
               style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)" }}>
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--sc-white)" }}>회원가입 시 노출</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--sc-dim)" }}>회원가입 화면의 역할 선택 목록에 표시</p>
            </div>
            <button type="button" onClick={() => setShowInSignup(!showInSignup)}
              className="w-11 h-6 rounded-full transition-all relative flex-shrink-0"
              style={{ background: showInSignup ? "var(--sc-green)" : "var(--sc-border)" }}>
              <div className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                   style={{ background: "var(--sc-bg)", left: showInSignup ? "calc(100% - 22px)" : 2 }} />
            </button>
          </div>

          {/* 권한 매트릭스 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--sc-dim)" }}>메뉴 권한</p>
            <div className="space-y-2">
              {ALL_CATEGORIES.map((cat) => {
                const allOn = cat.modules.every((m) => perms[cat.id]?.has(m.key));
                const someOn = cat.modules.some((m) => perms[cat.id]?.has(m.key));
                return (
                  <div key={cat.id} className="rounded-xl overflow-hidden"
                       style={{ border: "1px solid var(--sc-border)" }}>
                    {/* 카테고리 헤더 */}
                    <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer"
                         style={{ background: "var(--sc-raised)" }}
                         onClick={() => toggleAllModules(cat.id)}>
                      <span className="text-sm font-bold" style={{ color: someOn ? "var(--sc-white)" : "var(--sc-dim)" }}>
                        {cat.label}
                      </span>
                      <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                           style={{
                             background: allOn ? "var(--sc-green)" : someOn ? "var(--card-spot)" : "var(--sc-surface)",
                             border: `1px solid ${allOn || someOn ? "var(--sc-green)" : "var(--sc-border)"}`,
                           }}>
                        {(allOn || someOn) && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                            {allOn
                              ? <polyline points="2 6 5 9 10 3" stroke="var(--sc-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              : <line x1="2" y1="6" x2="10" y2="6" stroke="var(--sc-bg)" strokeWidth="2" strokeLinecap="round"/>
                            }
                          </svg>
                        )}
                      </div>
                    </div>
                    {/* 모듈 목록 */}
                    <div className="px-4 py-2 grid grid-cols-2 gap-1.5"
                         style={{ background: "var(--sc-surface)" }}>
                      {cat.modules.map((m) => {
                        const on = perms[cat.id]?.has(m.key) ?? false;
                        return (
                          <button key={m.key} type="button"
                            onClick={() => toggleModule(cat.id, m.key)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all"
                            style={{
                              background: on ? "var(--card-spot)" : "var(--sc-raised)",
                              border:     `1px solid ${on ? "var(--card-spot)" : "var(--sc-border)"}`,
                            }}>
                            <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                                 style={{ background: on ? "var(--sc-green)" : "var(--sc-surface)", border: `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}` }}>
                              {on && <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><polyline points="2 6 5 9 10 3" stroke="var(--sc-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <span className="text-xs font-medium" style={{ color: on ? "var(--sc-white)" : "var(--sc-dim)" }}>
                              {m.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 카테고리 순서 */}
          {visibleCats.length > 1 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--sc-dim)" }}>
                카테고리 표시 순서
              </p>
              <div className="space-y-1.5">
                {visibleCats.map((catId, idx) => {
                  const cat = ALL_CATEGORIES.find((c) => c.id === catId)!;
                  return (
                    <div key={catId} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                         style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)" }}>
                      <span className="text-sm font-semibold" style={{ color: "var(--sc-white)" }}>
                        {idx + 1}. {cat.label}
                      </span>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => moveCat(idx, -1)} disabled={idx === 0}
                          className="w-6 h-6 rounded flex items-center justify-center transition-all hover:scale-110 disabled:opacity-20"
                          style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", color: "var(--sc-dim)" }}>▲</button>
                        <button type="button" onClick={() => moveCat(idx, 1)} disabled={idx === visibleCats.length - 1}
                          className="w-6 h-6 rounded flex items-center justify-center transition-all hover:scale-110 disabled:opacity-20"
                          style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", color: "var(--sc-dim)" }}>▼</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-center" style={{ color: "#f87171" }}>{error}</p>}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 grid grid-cols-2 gap-2"
             style={{ background: "var(--sc-raised)", borderTop: "1px solid var(--sc-border)" }}>
          <button onClick={onClose}
            className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background: "var(--sc-surface)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
            취소
          </button>
          <button onClick={handleSave} disabled={pending}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "var(--sc-green)", color: "var(--sc-bg)", opacity: pending ? 0.6 : 1 }}>
            {pending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 삭제 확인 ─────────────────────────────────────────────────────
function DeleteRoleConfirm({ role, onCancel, onConfirm }: {
  role: RoleRow; onCancel: () => void; onConfirm: () => void;
}) {
  const [pending, startTrans] = useTransition();
  const [error,   setError]   = useState("");

  function handleDelete() {
    startTrans(async () => {
      try { await deleteRoleAction(role.id); onConfirm(); }
      catch (e: any) { setError(e.message); }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onCancel} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-2xl p-6 shadow-2xl"
           style={{ background: "var(--sc-surface)", border: "1px solid rgba(239,68,68,0.3)" }}
           onClick={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-2" style={{ color: "var(--sc-white)" }}>역할 삭제</h3>
        <p className="text-sm mb-1" style={{ color: "var(--sc-dim)" }}>
          <span style={{ color: "var(--sc-white)", fontWeight: 700 }}>{role.label}</span> 역할을 삭제하시겠어요?
        </p>
        <p className="text-xs mb-5" style={{ color: "rgba(239,68,68,0.8)" }}>이 역할을 가진 유저들은 기본 역할로 남습니다.</p>
        {error && <p className="text-sm mb-3 text-center" style={{ color: "#f87171" }}>{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background: "var(--sc-raised)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>취소</button>
          <button onClick={handleDelete} disabled={pending}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.4)", opacity: pending ? 0.6 : 1 }}>
            {pending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 메인 역할 관리 컴포넌트 ───────────────────────────────────────
interface Props { roles: RoleRow[]; }

export default function RoleManager({ roles: initialRoles }: Props) {
  const [roles,       setRoles]      = useState(initialRoles);
  const [editTarget,  setEditTarget] = useState<RoleRow | null>(null);
  const [deleteTarget,setDeleteTarget] = useState<RoleRow | null>(null);
  const [showCreate,  setShowCreate] = useState(false);

  const RESERVED = ["admin", "manager", "user"];

  function reload() { window.location.reload(); }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm font-semibold" style={{ color: "var(--sc-dim)" }}>
          총 {roles.length}개 역할
        </p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
          style={{ background: "var(--sc-green)", color: "var(--sc-bg)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          역할 추가
        </button>
      </div>

      {/* 역할 카드 목록 */}
      <div className="space-y-2">
        {roles.map((r) => {
          const isReserved = RESERVED.includes(r.name);
          const moduleCount = Object.values(r.permissions).reduce((acc, arr) => acc + arr.length, 0);
          return (
            <div key={r.id}
              className="flex items-center justify-between px-5 py-4 rounded-2xl group transition-colors"
              style={{ background: "var(--sc-raised)", border: "1px solid var(--sc-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = r.color + "44")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--sc-border)")}>

              {/* 색상 dot + 정보 */}
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: r.color }} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm" style={{ color: "var(--sc-white)" }}>{r.label}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "var(--sc-surface)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                      {r.name}
                    </span>
                    {isReserved && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                            style={{ background: "var(--card-spot)", color: "var(--sc-green)", border: "1px solid var(--card-spot)" }}>
                        기본
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--sc-dim)" }}>
                    메뉴 {moduleCount}개 · {r.show_in_signup ? "가입 시 선택 가능" : "가입 시 미노출"}
                    {r.category_order.length > 0 && ` · 카테고리 ${r.category_order.length}개`}
                  </p>
                </div>
              </div>

              {/* 액션 */}
              <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditTarget(r)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                  style={{ background: "var(--sc-surface)", color: "var(--sc-dim)", border: "1px solid var(--sc-border)" }}>
                  편집
                </button>
                {!isReserved && (
                  <button onClick={() => setDeleteTarget(r)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 신규 역할 모달 */}
      {showCreate && (
        <RoleFormModal onClose={() => setShowCreate(false)} onSaved={reload} />
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <RoleFormModal initial={editTarget} onClose={() => setEditTarget(null)} onSaved={reload} />
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <DeleteRoleConfirm role={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={reload} />
      )}
    </div>
  );
}
