"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RoleRow } from "@/types";
import {
  updateUserProfile, createUser, deleteUser, approveUser,
} from "@/app/admin/users/actions";
import DateInput from "@/components/ui/DateInput";

// ── 타입 ──────────────────────────────────────────────────────────
export interface UserRow {
  id:              string;
  name:            string;
  login_id?:       string;
  email:           string;
  role:            string;
  birthdate?:      string;
  school?:         string;
  phone?:          string;
  gender?:         string;
  approval_status: "pending" | "approved";
  created_at:      string;
  last_sign_in?:   string;
}

// ── 아이콘 ────────────────────────────────────────────────────────
const ip = { width:15, height:15, viewBox:"0 0 24 24", fill:"none",
  stroke:"currentColor", strokeWidth:1.75,
  strokeLinecap:"round" as const, strokeLinejoin:"round" as const };

const HomeIcon   = () => <svg {...ip}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const EyeIcon    = () => <svg {...ip}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const EyeOffIcon = () => <svg {...ip}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const PlusIcon   = () => <svg {...ip}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const PencilIcon = () => <svg {...ip}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const TrashIcon  = () => <svg {...ip}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>;
const CheckIcon  = () => <svg {...ip}><polyline points="20 6 9 17 4 12"/></svg>;

const GENDER_KO: Record<string, string> = { male:"남", female:"여", other:"기타" };

// ── 공통: 역할 선택기 ─────────────────────────────────────────────
function RoleSelector({ value, onChange, roles }: {
  value: string; onChange: (v: string) => void; roles: RoleRow[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => {
        const on = value === r.name;
        return (
          <button key={r.name} type="button" onClick={() => onChange(r.name)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: on ? `${r.color}22` : "var(--sc-raised)",
              color:      on ? r.color         : "var(--sc-dim)",
              border:     `1px solid ${on ? r.color : "var(--sc-border)"}`,
              transform:  on ? "scale(1.05)" : "scale(1)",
            }}>
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ── 유저 수정 모달 ────────────────────────────────────────────────
function EditUserModal({ user, roles, onClose, onSaved }: {
  user:    UserRow;
  roles:   RoleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name,     setName]     = useState(user.name);
  const [role,     setRole]     = useState(user.role);
  const [loginId,  setLoginId]  = useState(user.login_id ?? "");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [birthdate,setBirthdate]= useState(user.birthdate ?? "");
  const [school,   setSchool]   = useState(user.school ?? "");
  const [phone,    setPhone]    = useState(user.phone ?? "");
  const [gender,   setGender]   = useState(user.gender ?? "");
  const [pending,  startTrans]  = useTransition();
  const [error,    setError]    = useState("");

  const GENDER_OPTIONS = [
    { value: "male", label: "남" },
    { value: "female", label: "여" },
  ];

  function handleSave() {
    if (!name.trim()) { setError("이름을 입력하세요."); return; }
    setError("");
    startTrans(async () => {
      try {
        await updateUserProfile(user.id, {
          name: name.trim(), role,
          login_id: loginId.trim() || null,
          password: password || null,
          birthdate: birthdate || null,
          school: school.trim() || null,
          phone: phone.trim() || null,
          gender: gender || null,
        });
        onSaved();
        onClose();
      } catch (e: any) { setError(e.message); }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background:"rgba(0,0,0,0.7)", backdropFilter:"blur(5px)" }} onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
           style={{ border:"1px solid var(--sc-border)", maxHeight:"88vh" }}
           onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between"
             style={{ background:"var(--sc-raised)", borderBottom:"1px solid var(--sc-border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color:"var(--sc-dim)" }}>유저 수정</p>
            <h3 className="font-black text-lg" style={{ color:"var(--sc-white)" }}>{user.name}</h3>
            <p className="text-xs mt-0.5" style={{ color:"var(--sc-dim)" }}>{user.login_id ?? user.email}</p>
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60" style={{ color:"var(--sc-dim)" }}>×</button>
        </div>

        {/* 바디 */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto"
             style={{ background:"var(--sc-surface)", maxHeight:"calc(88vh - 130px)" }}>

          {/* 이름 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>이름 *</p>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="sc-input text-sm w-full" autoFocus />
          </div>

          {/* 역할 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color:"var(--sc-dim)" }}>역할</p>
            <RoleSelector value={role} onChange={setRole} roles={roles} />
          </div>

          {/* 아이디 + 비밀번호 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>로그인 아이디</p>
              <input value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())}
                placeholder="영문/숫자/_" className="sc-input text-sm w-full" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>비밀번호 변경</p>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="8자 이상 (미입력 시 유지)" className="sc-input text-sm w-full" style={{ paddingRight: 34 }} />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color:"var(--sc-dim)", lineHeight:0 }}>
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </div>

          {/* 생년월일 + 학교 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>생년월일</p>
              <DateInput value={birthdate} onChange={setBirthdate} inputStyle={{ fontSize: 13 }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>학교</p>
              <input value={school} onChange={(e) => setSchool(e.target.value)}
                placeholder="○○고등학교" className="sc-input text-sm w-full" />
            </div>
          </div>

          {/* 연락처 + 성별 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>연락처</p>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000" className="sc-input text-sm w-full" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color:"var(--sc-dim)" }}>성별</p>
              <div className="flex gap-1">
                {GENDER_OPTIONS.map((g) => {
                  const on = gender === g.value;
                  return (
                    <button key={g.value} type="button" onClick={() => setGender(on ? "" : g.value)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: on ? "var(--sc-green)" : "var(--sc-raised)",
                        color:      on ? "var(--sc-bg)"    : "var(--sc-dim)",
                        border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                      }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-center" style={{ color:"#f87171" }}>{error}</p>}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 grid grid-cols-2 gap-2"
             style={{ background:"var(--sc-raised)", borderTop:"1px solid var(--sc-border)" }}>
          <button onClick={onClose} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background:"var(--sc-surface)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>취소</button>
          <button onClick={handleSave} disabled={pending}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background:"var(--sc-green)", color:"var(--sc-bg)", opacity: pending ? 0.6 : 1 }}>
            {pending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 유저 추가 모달 ────────────────────────────────────────────────
function CreateUserModal({ roles, onClose, onSaved }: {
  roles: RoleRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [loginId,  setLoginId]  = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [name,     setName]     = useState("");
  const [role,     setRole]     = useState(roles[0]?.name ?? "user");
  const [birthdate,setBirthdate]= useState("");
  const [school,   setSchool]   = useState("");
  const [phone,    setPhone]    = useState("");
  const [gender,   setGender]   = useState("");
  const [pending,  startTrans]  = useTransition();
  const [error,    setError]    = useState("");

  const GENDER_OPTIONS = [
    { value: "male", label: "남" },
    { value: "female", label: "여" },
  ];

  function handleCreate() {
    if (!loginId.trim() || !name.trim() || !password) { setError("아이디, 이름, 비밀번호는 필수입니다."); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(loginId)) { setError("아이디는 영문, 숫자, _만 사용 가능합니다."); return; }
    setError("");
    startTrans(async () => {
      try {
        await createUser({
          loginId: loginId.toLowerCase(), password, name: name.trim(), role,
          birthdate: birthdate || undefined, school: school.trim() || undefined,
          phone: phone.trim() || undefined, gender: gender || undefined,
          autoApprove: true,
        });
        onSaved();
        onClose();
      } catch (e: any) { setError(e.message); }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background:"rgba(0,0,0,0.7)", backdropFilter:"blur(5px)" }} onClick={onClose} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
           style={{ border:"1px solid var(--sc-border)", maxHeight:"88vh" }}
           onClick={(e) => e.stopPropagation()}>

        <div className="px-6 pt-5 pb-4 flex items-start justify-between"
             style={{ background:"var(--sc-raised)", borderBottom:"1px solid var(--sc-border)" }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color:"var(--sc-dim)" }}>유저 추가</p>
            <h3 className="font-black text-lg" style={{ color:"var(--sc-white)" }}>새 유저 추가</h3>
          </div>
          <button onClick={onClose} className="text-xl hover:opacity-60" style={{ color:"var(--sc-dim)" }}>×</button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto"
             style={{ background:"var(--sc-surface)", maxHeight:"calc(88vh - 130px)" }}>

          {/* 아이디 + 비밀번호 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>아이디 *</p>
              <input value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())}
                placeholder="영문/숫자/_" autoFocus className="sc-input text-sm w-full" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>비밀번호 *</p>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="8자 이상" className="sc-input text-sm w-full" style={{ paddingRight: 34 }} />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color:"var(--sc-dim)", lineHeight:0 }}>
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
          </div>

          {/* 이름 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>이름 *</p>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="홍길동" className="sc-input text-sm w-full" />
          </div>

          {/* 역할 */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color:"var(--sc-dim)" }}>역할</p>
            <RoleSelector value={role} onChange={setRole} roles={roles} />
          </div>

          {/* 생년월일 + 학교 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>생년월일</p>
              <DateInput value={birthdate} onChange={setBirthdate} inputStyle={{ fontSize: 13 }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>학교</p>
              <input value={school} onChange={(e) => setSchool(e.target.value)}
                placeholder="○○고등학교" className="sc-input text-sm w-full" />
            </div>
          </div>

          {/* 연락처 + 성별 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"var(--sc-dim)" }}>연락처</p>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000" className="sc-input text-sm w-full" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color:"var(--sc-dim)" }}>성별</p>
              <div className="flex gap-1">
                {GENDER_OPTIONS.map((g) => {
                  const on = gender === g.value;
                  return (
                    <button key={g.value} type="button" onClick={() => setGender(on ? "" : g.value)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: on ? "var(--sc-green)" : "var(--sc-raised)",
                        color:      on ? "var(--sc-bg)"    : "var(--sc-dim)",
                        border:     `1px solid ${on ? "var(--sc-green)" : "var(--sc-border)"}`,
                      }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-center" style={{ color:"#f87171" }}>{error}</p>}
        </div>

        <div className="px-6 py-4 grid grid-cols-2 gap-2"
             style={{ background:"var(--sc-raised)", borderTop:"1px solid var(--sc-border)" }}>
          <button onClick={onClose} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background:"var(--sc-surface)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>취소</button>
          <button onClick={handleCreate} disabled={pending}
            className="py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
            style={{ background:"var(--sc-green)", color:"var(--sc-bg)", opacity: pending ? 0.6 : 1 }}>
            {pending ? "추가 중..." : <><PlusIcon /> 추가</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 삭제 확인 ─────────────────────────────────────────────────────
function DeleteConfirm({ user, onCancel, onConfirm }: {
  user: UserRow; onCancel: () => void; onConfirm: () => void;
}) {
  const [pending, startTrans] = useTransition();
  const [error,   setError]   = useState("");

  function handleDelete() {
    startTrans(async () => {
      try { await deleteUser(user.id); onConfirm(); }
      catch (e: any) { setError(e.message); }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)" }} onClick={onCancel} />
      <div className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-2xl p-6 shadow-2xl"
           style={{ background:"var(--sc-surface)", border:"1px solid rgba(239,68,68,0.3)" }}
           onClick={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-2" style={{ color:"var(--sc-white)" }}>유저 삭제</h3>
        <p className="text-sm mb-1" style={{ color:"var(--sc-dim)" }}>
          <span style={{ color:"var(--sc-white)", fontWeight:700 }}>{user.name}</span> 계정을 삭제하시겠어요?
        </p>
        <p className="text-xs mb-5" style={{ color:"rgba(239,68,68,0.8)" }}>로그인 정보와 모든 관련 데이터가 삭제됩니다.</p>
        {error && <p className="text-sm mb-3 text-center" style={{ color:"#f87171" }}>{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="py-2.5 rounded-xl text-sm font-bold"
            style={{ background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>취소</button>
          <button onClick={handleDelete} disabled={pending}
            className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background:"rgba(239,68,68,0.15)", color:"#f87171", border:"1px solid rgba(239,68,68,0.4)", opacity: pending ? 0.6 : 1 }}>
            {pending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
interface Props { users: UserRow[]; roles: RoleRow[]; currentUserId: string; }

export default function UserManager({ users: initialUsers, roles, currentUserId }: Props) {
  const [users,        setUsers]        = useState(initialUsers);
  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved">("all");
  const [editTarget,   setEditTarget]   = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);

  const roleMap = Object.fromEntries(roles.map((r) => [r.name, r]));

  const pendingCount = users.filter((u) => u.approval_status === "pending").length;

  // 필터 적용
  const filtered = users.filter((u) => {
    const matchRole   = roleFilter === "all" || u.role === roleFilter;
    const matchStatus = statusFilter === "all" || u.approval_status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      u.name.toLowerCase().includes(q) ||
      (u.login_id ?? "").toLowerCase().includes(q) ||
      (u.school ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").includes(q);
    return matchRole && matchStatus && matchSearch;
  });

  function formatDate(iso?: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ko-KR", { year:"2-digit", month:"2-digit", day:"2-digit" });
  }

  function formatBirthdate(bd?: string) {
    if (!bd) return "—";
    const d = new Date(bd);
    return d.toLocaleDateString("ko-KR", { year:"2-digit", month:"2-digit", day:"2-digit" });
  }

  function reload() { window.location.reload(); }

  async function handleApprove(userId: string) {
    try {
      await approveUser(userId);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approval_status: "approved" } : u));
    } catch (e: any) { alert("승인 실패: " + e.message); }
  }

  return (
    <div>
      {/* 툴바 */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 검색 */}
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 아이디 / 학교 검색..."
            className="sc-input text-sm" style={{ padding:"8px 14px", width: 230 }} />

          {/* 역할 필터 */}
          <div className="flex gap-1">
            <button onClick={() => setRoleFilter("all")}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{ background: roleFilter === "all" ? "var(--sc-green)" : "var(--sc-raised)", color: roleFilter === "all" ? "var(--sc-bg)" : "var(--sc-dim)", border: `1px solid ${roleFilter === "all" ? "var(--sc-green)" : "var(--sc-border)"}` }}>
              전체 {users.length}
            </button>
            {roles.map((r) => {
              const cnt = users.filter((u) => u.role === r.name).length;
              const on  = roleFilter === r.name;
              return (
                <button key={r.name} onClick={() => setRoleFilter(r.name)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{ background: on ? `${r.color}22` : "var(--sc-raised)", color: on ? r.color : "var(--sc-dim)", border: `1px solid ${on ? r.color : "var(--sc-border)"}` }}>
                  {r.label} {cnt}
                </button>
              );
            })}
          </div>

          {/* 승인 상태 필터 */}
          {pendingCount > 0 && (
            <div className="flex gap-1">
              <button onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
                className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all"
                style={{ background: statusFilter === "pending" ? "rgba(251,191,36,0.15)" : "var(--sc-raised)", color: statusFilter === "pending" ? "#fbbf24" : "var(--sc-dim)", border: `1px solid ${statusFilter === "pending" ? "rgba(251,191,36,0.4)" : "var(--sc-border)"}` }}>
                승인 대기
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black"
                      style={{ background: "rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                  {pendingCount}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* 유저 추가 */}
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95 flex-shrink-0"
          style={{ background:"var(--sc-green)", color:"var(--sc-bg)" }}>
          <PlusIcon /> 유저 추가
        </button>
      </div>

      {/* 테이블 */}
      <div className="rounded-2xl overflow-hidden" style={{ border:"1px solid var(--sc-border)" }}>
        {/* 헤더 */}
        <div className="grid text-[10px] font-bold uppercase tracking-widest px-5 py-3"
             style={{
               gridTemplateColumns:"1.4fr 1fr 90px 90px 90px 90px 70px",
               background:"var(--sc-raised)",
               borderBottom:"1px solid var(--sc-border)",
               color:"var(--sc-dim)",
             }}>
          <div>이름</div>
          <div>아이디</div>
          <div>역할</div>
          <div>학교</div>
          <div>연락처</div>
          <div>생년월일</div>
          <div style={{ textAlign:"right" }}>관리</div>
        </div>

        {/* 행 */}
        {filtered.length === 0 ? (
          <div className="text-center py-12" style={{ color:"var(--sc-dim)", fontSize:14 }}>
            {search ? `"${search}" 검색 결과 없음` : "유저가 없습니다."}
          </div>
        ) : (
          filtered.map((u, i) => {
            const isMe      = u.id === currentUserId;
            const isPending = u.approval_status === "pending";
            const roleMeta  = roleMap[u.role];

            return (
              <div key={u.id}
                className="grid items-center px-5 py-3.5 group transition-colors"
                style={{
                  gridTemplateColumns:"1.4fr 1fr 90px 90px 90px 90px 70px",
                  borderBottom: i < filtered.length - 1 ? "1px solid var(--sc-border)" : "none",
                  background: isPending ? "rgba(251,191,36,0.03)" : "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isPending ? "rgba(251,191,36,0.06)" : "var(--sc-raised)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = isPending ? "rgba(251,191,36,0.03)" : "transparent")}
              >
                {/* 이름 + 상태 */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                       style={{ background: roleMeta ? `${roleMeta.color}22` : "var(--sc-raised)", color: roleMeta?.color ?? "var(--sc-dim)" }}>
                    {u.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate" style={{ color:"var(--sc-white)" }}>
                        {u.name}
                        {isMe && <span className="ml-1 text-[10px] font-bold opacity-40">(나)</span>}
                      </span>
                      {isPending && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background:"rgba(251,191,36,0.15)", color:"#fbbf24", border:"1px solid rgba(251,191,36,0.3)" }}>
                          대기
                        </span>
                      )}
                    </div>
                    {u.gender && (
                      <span className="text-[10px]" style={{ color:"var(--sc-dim)" }}>
                        {GENDER_KO[u.gender] ?? u.gender}
                      </span>
                    )}
                  </div>
                </div>

                {/* 아이디 */}
                <div className="text-xs truncate font-mono" style={{ color:"var(--sc-dim)" }}>
                  {u.login_id ?? "—"}
                </div>

                {/* 역할 */}
                <div>
                  {roleMeta ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                          style={{ color: roleMeta.color, background: `${roleMeta.color}18`, border:`1px solid ${roleMeta.color}33` }}>
                      {roleMeta.label}
                    </span>
                  ) : (
                    <span className="text-[10px]" style={{ color:"var(--sc-dim)" }}>{u.role}</span>
                  )}
                </div>

                {/* 학교 */}
                <div className="text-xs truncate" style={{ color:"var(--sc-dim)" }}>{u.school ?? "—"}</div>

                {/* 연락처 */}
                <div className="text-xs truncate" style={{ color:"var(--sc-dim)" }}>{u.phone ?? "—"}</div>

                {/* 생년월일 */}
                <div className="text-xs" style={{ color:"var(--sc-dim)" }}>{formatBirthdate(u.birthdate)}</div>

                {/* 액션 */}
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isPending && (
                    <button onClick={() => handleApprove(u.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                      title="승인"
                      style={{ background:"var(--card-spot)", color:"var(--sc-green)", border:"1px solid var(--card-spot)" }}>
                      <CheckIcon />
                    </button>
                  )}
                  <button onClick={() => setEditTarget(u)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                    style={{ background:"var(--sc-surface)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
                    <PencilIcon />
                  </button>
                  {!isMe && (
                    <button onClick={() => setDeleteTarget(u)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                      style={{ background:"rgba(239,68,68,0.1)", color:"#f87171", border:"1px solid rgba(239,68,68,0.3)" }}>
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs mt-3 text-right" style={{ color:"var(--sc-dim)" }}>
        {filtered.length}명 표시 (전체 {users.length}명)
      </p>

      {/* 모달들 */}
      {editTarget && (
        <EditUserModal user={editTarget} roles={roles}
          onClose={() => setEditTarget(null)} onSaved={reload} />
      )}
      {deleteTarget && (
        <DeleteConfirm user={deleteTarget}
          onCancel={() => setDeleteTarget(null)} onConfirm={() => { setUsers((p) => p.filter((u) => u.id !== deleteTarget.id)); setDeleteTarget(null); }} />
      )}
      {showCreate && (
        <CreateUserModal roles={roles} onClose={() => setShowCreate(false)} onSaved={reload} />
      )}
    </div>
  );
}
