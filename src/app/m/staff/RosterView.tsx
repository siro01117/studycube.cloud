"use client";

// 직원 관리 "명단" 탭. 재직·퇴사 직원 목록 + 초대 대기 + 대기 중 신청(승인 대기) 표시.
// 권한 갈림: account.provision 이면 추가·수정·퇴사 처리가 그 자리에서 끝난다(모드 "바로 처리").
// account.request 만 있으면 같은 동작이 신청으로 올라가고 CTO 승인을 기다린다(모드 "승인 대기").
// 두 모드 모두 같은 폼을 쓰되, 제출 후 안내 문구와 결과 화면(초대 코드 표시 여부)만 달라진다.
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Modal from "../_shared/Modal";
import { useSort, SortHeader, type SortColumn } from "../_shared/sort";
import {
  addStaff, editStaff, retireStaff, revokeStaffInvite, decideRequest,
  type RosterActionResult,
} from "./rosterActions";
import type { StaffInviteRow } from "@/lib/staff-invite";
import type { AccountRequestRow } from "@/lib/account-request";

export type RosterPerson = {
  id: string;
  name: string;
  phone: string | null;
  title: string | null;
  hiredAt: string | null;
  leftAt: string | null;
  active: boolean;
  roleLabel: string | null;
  roleId: string | null;
};
export type RoleOption = { id: string; key: string; label: string };

const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--sub)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "10px 12px", fontSize: 13.5, borderBottom: "1px solid var(--line)", verticalAlign: "middle" };

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" style={{ width: 13, height: 13, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
const BellIcon = () => (
  <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M8 2.2c-2 0-3.4 1.6-3.4 3.6v1.9L3.4 10.4h9.2L11.4 7.7V5.8c0-2-1.4-3.6-3.4-3.6z" />
    <path d="M6.5 12.6a1.5 1.5 0 0 0 3 0" />
  </svg>
);

// created_at/expires_at 등 timestamptz 컬럼은 드라이버에 따라 Date 인스턴스로 오기도 하고
// (postgres.js) 문자열로 오기도 한다(PGlite) — 둘 다 받아 안전하게 날짜만 뽑는다.
function fmtDate(d: string | Date | null): string {
  if (!d) return "–";
  const iso = d instanceof Date ? d.toISOString() : d;
  return iso.slice(0, 10);
}
function daysLeft(iso: string | Date): number {
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  return Math.ceil((t - Date.now()) / 86400000);
}

const SORT_COLUMNS: SortColumn<RosterPerson>[] = [
  { key: "name", label: "이름", sortValue: (p) => p.name },
  { key: "title", label: "직함", sortValue: (p) => p.title },
  { key: "phone", label: "연락처", sortValue: (p) => p.phone },
  { key: "hiredAt", label: "입사일", sortValue: (p) => p.hiredAt },
  { key: "status", label: "상태", sortValue: (p) => (p.active ? "재직" : "퇴사") },
  { key: "role", label: "역할", sortValue: (p) => p.roleLabel },
];

export default function RosterView({
  persons, invites, pendingRequests, roles, canProvision, canRequest,
}: {
  persons: RosterPerson[];
  invites: StaffInviteRow[];
  pendingRequests: AccountRequestRow[];
  roles: RoleOption[];
  canProvision: boolean;
  canRequest: boolean;
}) {
  const canAct = canProvision || canRequest;
  const { sorted, sortKey, sortDir, requestSort } = useSort(persons, SORT_COLUMNS, "name", "sc-staff-roster");
  const [, start] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<RosterPerson | null>(null);
  const [retiring, setRetiring] = useState<RosterPerson | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ title: string; invite?: StaffInviteRow } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const inviteUrl = (code: string) => (typeof window !== "undefined" ? `${window.location.origin}/invite/${code}` : `/invite/${code}`);

  const handleResult = (r: RosterActionResult, doneTitle: string) => {
    if (!r.ok) { setErr(r.error); return; }
    setErr(null);
    if (r.mode === "direct") {
      setResultMsg({ title: doneTitle, invite: r.invite });
    } else {
      setResultMsg({ title: "신청이 접수됐습니다. CTO 승인을 기다려주세요." });
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px 40px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div className="flex items-center gap-2">
          {pendingRequests.length > 0 && canAct && (
            <button className="chip" onClick={() => setRequestsOpen(true)} style={{ color: "var(--warn)", borderColor: "var(--warn)", fontWeight: 700, gap: 6 }}>
              <BellIcon /> 대기 중인 신청 {pendingRequests.length}건
            </button>
          )}
        </div>
        {canAct && (
          <button className="btn btn-accent" onClick={() => setAddOpen(true)} style={{ height: 40, padding: "0 16px", gap: 6 }}>
            <PlusIcon /> 직원 추가
          </button>
        )}
      </div>

      {invites.filter((i) => i.status === "pending").length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>초대 대기</div>
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>이름</th><th style={th}>직함</th><th style={th}>발급일</th><th style={th}>만료</th>
                {canProvision && <th style={th}>코드</th>}
                {canProvision && <th style={th} />}
              </tr></thead>
              <tbody>
                {invites.filter((i) => i.status === "pending").map((inv) => {
                  const left = daysLeft(inv.expires_at);
                  return (
                    <tr key={inv.id}>
                      <td style={td}>{inv.name}</td>
                      <td style={{ ...td, color: "var(--sub)" }}>{inv.title ?? "–"}</td>
                      <td style={{ ...td, color: "var(--sub)" }}>{fmtDate(inv.created_at)}</td>
                      <td style={{ ...td, color: left <= 1 ? "var(--danger-strong)" : "var(--sub)" }}>{left <= 0 ? "만료됨" : `${left}일 남음`}</td>
                      {canProvision && (
                        <td style={td}>
                          {inv.code ? (
                            <code style={{ fontSize: 12, background: "var(--panel2)", padding: "3px 6px", borderRadius: 6, letterSpacing: "0.06em" }}>{inv.code}</code>
                          ) : "–"}
                        </td>
                      )}
                      {canProvision && (
                        <td style={td}>
                          <button
                            className="chip"
                            style={{ color: "var(--danger-strong)" }}
                            onClick={() => start(async () => {
                              const fd = new FormData(); fd.set("id", inv.id);
                              const r = await revokeStaffInvite(fd);
                              if (!r.ok) setErr(r.error);
                            })}
                          >
                            취소
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {SORT_COLUMNS.map((c) => (
                <SortHeader key={c.key} label={c.label} sortKey={c.key} activeKey={sortKey} dir={sortDir} onSort={requestSort} thStyle={th} />
              ))}
              {canAct && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.6 }}>
                <td style={{ ...td, fontWeight: 700 }}>{p.name}</td>
                <td style={{ ...td, color: "var(--sub)" }}>{p.title ?? "–"}</td>
                <td style={{ ...td, color: "var(--sub)" }}>{p.phone ?? "–"}</td>
                <td style={{ ...td, color: "var(--sub)" }}>{fmtDate(p.hiredAt)}</td>
                <td style={td}>
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    background: p.active ? "var(--ok-soft)" : "var(--panel2)",
                    color: p.active ? "var(--ok)" : "var(--sub)",
                  }}>
                    {p.active ? "재직" : "퇴사"}
                  </span>
                  {!p.active && p.leftAt && <span style={{ marginLeft: 6, fontSize: 11.5, color: "var(--faint)" }}>{fmtDate(p.leftAt)}</span>}
                </td>
                <td style={{ ...td, color: "var(--sub)" }}>{p.roleLabel ?? "–"}</td>
                {canAct && (
                  <td style={td}>
                    <div className="flex items-center gap-2">
                      <button className="chip" onClick={() => setEditing(p)}>수정</button>
                      {p.active && <button className="chip" style={{ color: "var(--danger-strong)" }} onClick={() => setRetiring(p)}>퇴사 처리</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- 직원 추가 ---------------- */}
      {addOpen && (
        <Modal
          onClose={() => setAddOpen(false)}
          backdropBackground="rgba(20,22,30,.45)" backdropZIndex={60} panelZIndex={61}
          panelStyle={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>직원 추가</div>
            <button onClick={() => setAddOpen(false)} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center" }}><CloseIcon /></button>
          </div>
          <p style={{ margin: "14px 22px 0", fontSize: 12.5, color: "var(--sub)" }}>
            {canProvision ? "저장하면 즉시 초대 코드가 발급됩니다. 아이디·비밀번호는 본인이 정합니다." : "저장하면 CTO 승인 대기 상태로 올라갑니다."}
          </p>
          <StaffForm
            roles={roles} showReason={!canProvision}
            onCancel={() => setAddOpen(false)}
            onSubmit={async (fd) => {
              const r = await addStaff(fd);
              setAddOpen(false);
              handleResult(r, "초대 코드가 발급됐습니다.");
            }}
          />
        </Modal>
      )}

      {/* ---------------- 수정 ---------------- */}
      {editing && (
        <Modal
          onClose={() => setEditing(null)}
          backdropBackground="rgba(20,22,30,.45)" backdropZIndex={60} panelZIndex={61}
          panelStyle={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{editing.name} 정보 수정</div>
            <button onClick={() => setEditing(null)} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center" }}><CloseIcon /></button>
          </div>
          <p style={{ margin: "14px 22px 0", fontSize: 12.5, color: "var(--sub)" }}>
            {canProvision ? "저장하면 바로 반영됩니다." : "저장하면 CTO 승인 대기 상태로 올라갑니다."}
          </p>
          <StaffForm
            roles={roles} showReason={!canProvision} person={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (fd) => {
              fd.set("personId", editing.id);
              const r = await editStaff(fd);
              setEditing(null);
              handleResult(r, "정보가 수정됐습니다.");
            }}
          />
        </Modal>
      )}

      {/* ---------------- 퇴사 처리 ---------------- */}
      {retiring && (
        <Modal
          onClose={() => setRetiring(null)}
          backdropBackground="rgba(20,22,30,.45)" backdropZIndex={60} panelZIndex={61}
          panelStyle={{ width: 380, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div style={{ padding: 22 }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>{retiring.name} 퇴사 처리</div>
            <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14 }}>
              로그인은 즉시 막히지만 기록(급여·근무 이력)은 남습니다.{canProvision ? "" : " CTO 승인 후 처리됩니다."}
            </p>
            <form
              action={(fd) => start(async () => {
                fd.set("personId", retiring.id);
                const r = await retireStaff(fd);
                setRetiring(null);
                handleResult(r, "퇴사 처리됐습니다.");
              })}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div>
                <label className="label" htmlFor="retire-date">퇴사일</label>
                <input id="retire-date" className="input" name="leftAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={{ height: 42 }} />
              </div>
              {!canProvision && (
                <div>
                  <label className="label" htmlFor="retire-reason">신청 사유</label>
                  <input id="retire-reason" className="input" name="reason" placeholder="퇴사 처리 사유" style={{ height: 42 }} />
                </div>
              )}
              <div className="flex gap-2" style={{ marginTop: 4 }}>
                <button type="button" className="btn" style={{ flex: 1, height: 42 }} onClick={() => setRetiring(null)}>취소</button>
                <button className="btn" style={{ flex: 1, height: 42, background: "var(--danger-strong)", borderColor: "var(--danger-strong)", color: "#fff" }}>확인</button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* ---------------- 처리 결과 ---------------- */}
      {resultMsg && (
        <Modal
          onClose={() => setResultMsg(null)}
          backdropBackground="rgba(20,22,30,.45)" backdropZIndex={70} panelZIndex={71}
          panelStyle={{ width: 400, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div style={{ padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{resultMsg.title}</div>
            {resultMsg.invite && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12.5, color: "var(--sub)" }}>아래 코드(또는 링크)를 전달하세요. {INVITE_TTL_LABEL}</div>
                <code style={{ display: "block", fontSize: 18, fontWeight: 800, letterSpacing: "0.1em", background: "var(--panel2)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                  {resultMsg.invite.code}
                </code>
                <div style={{ fontSize: 12, color: "var(--faint)", wordBreak: "break-all" }}>{inviteUrl(resultMsg.invite.code)}</div>
              </div>
            )}
            <button className="btn btn-accent" style={{ width: "100%", height: 42, marginTop: 16 }} onClick={() => setResultMsg(null)}>확인</button>
          </div>
        </Modal>
      )}

      {err && (
        <Modal
          onClose={() => setErr(null)}
          backdropBackground="rgba(20,22,30,.45)" backdropZIndex={70} panelZIndex={71}
          panelStyle={{ width: 340, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div style={{ padding: 22 }}>
            <div style={{ fontSize: 14.5, color: "var(--danger-strong)", marginBottom: 14 }}>{err}</div>
            <button className="btn" style={{ width: "100%", height: 40 }} onClick={() => setErr(null)}>닫기</button>
          </div>
        </Modal>
      )}

      {/* ---------------- 신청 승인·반려 ---------------- */}
      {requestsOpen && (
        <RequestsModal
          requests={pendingRequests}
          canDecide={canProvision}
          onClose={() => setRequestsOpen(false)}
          onDecided={(msg, invite) => { setRequestsOpen(false); setResultMsg({ title: msg, invite }); }}
        />
      )}
    </div>
  );
}

const INVITE_TTL_LABEL = "7일 안에 사용하지 않으면 만료됩니다.";

// ---------------- 공용: 이름·연락처·직함·입사일·역할 폼 ----------------
function StaffForm({
  roles, showReason, person, onCancel, onSubmit,
}: {
  roles: RoleOption[];
  showReason: boolean;
  person?: RosterPerson;
  onCancel: () => void;
  onSubmit: (fd: FormData) => Promise<void> | void;
}) {
  const [, start] = useTransition();
  return (
    <form
      action={(fd) => start(() => onSubmit(fd))}
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div>
        <label className="label" htmlFor="sf-name">이름 *</label>
        <input id="sf-name" className="input" name="name" required defaultValue={person?.name} placeholder="홍길동" style={{ height: 42 }} autoFocus />
      </div>
      <div className="flex gap-2">
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="sf-title">직함</label>
          <input id="sf-title" className="input" name="title" defaultValue={person?.title ?? ""} placeholder="실장·조교·강사" style={{ height: 42 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="sf-phone">연락처</label>
          <input id="sf-phone" className="input" name="phone" defaultValue={person?.phone ?? ""} placeholder="010-0000-0000" style={{ height: 42 }} />
        </div>
      </div>
      <div className="flex gap-2">
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="sf-hired">입사일</label>
          <input id="sf-hired" className="input" name="hiredAt" type="date" defaultValue={person?.hiredAt?.slice(0, 10) ?? ""} style={{ height: 42 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label" htmlFor="sf-role">역할</label>
          <select id="sf-role" className="input" name="roleId" defaultValue={person?.roleId ?? ""} style={{ height: 42 }}>
            <option value="">선택 안 함</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>
      {showReason && (
        <div>
          <label className="label" htmlFor="sf-reason">신청 사유</label>
          <input id="sf-reason" className="input" name="reason" placeholder="신청 사유를 적어주세요" style={{ height: 42 }} />
        </div>
      )}
      <div className="flex gap-2" style={{ marginTop: 4 }}>
        <button type="button" className="btn" style={{ flex: 1, height: 44 }} onClick={onCancel}>취소</button>
        <button className="btn btn-accent" style={{ flex: 1, height: 44 }}>저장</button>
      </div>
    </form>
  );
}

// ---------------- 신청 승인·반려 모달 ----------------
const REQ_TYPE_LABEL: Record<string, string> = { create: "계정 생성", edit: "정보 수정", delete: "퇴사 처리" };

function RequestsModal({
  requests, canDecide, onClose, onDecided,
}: {
  requests: AccountRequestRow[];
  canDecide: boolean;
  onClose: () => void;
  onDecided: (msg: string, invite?: StaffInviteRow) => void;
}) {
  const [, start] = useTransition();
  const [rejecting, setRejecting] = useState<AccountRequestRow | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = (id: string, decision: "approved" | "rejected", noteText?: string) => {
    setBusyId(id);
    start(async () => {
      const fd = new FormData();
      fd.set("id", id); fd.set("decision", decision);
      if (noteText) fd.set("note", noteText);
      const r = await decideRequest(fd);
      setBusyId(null);
      setRejecting(null);
      if (!r.ok) return; // 실패는 조용히 목록에 남겨둔다 — 재시도 가능
      onDecided(decision === "approved" ? "승인 처리됐습니다." : "반려 처리됐습니다.", r.invite);
    });
  };

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)" backdropZIndex={65} panelZIndex={66}
      panelStyle={{ width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
    >
      <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>대기 중인 신청</div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center" }}><CloseIcon /></button>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {requests.length === 0 && <div style={{ fontSize: 13, color: "var(--sub)", padding: 10 }}>대기 중인 신청이 없습니다.</div>}
        {requests.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14 }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 999, padding: "2px 8px" }}>
                {REQ_TYPE_LABEL[r.req_type] ?? r.req_type}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{fmtDate(r.created_at)}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 13.5, fontWeight: 700 }}>{r.name ?? "(기존 직원)"}</div>
            {r.reason && <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--sub)" }}>사유: {r.reason}</div>}
            {canDecide && (
              <div className="flex gap-2" style={{ marginTop: 10 }}>
                <button
                  className="btn btn-accent" style={{ flex: 1, height: 36, fontSize: 12.5 }}
                  disabled={busyId === r.id}
                  onClick={() => decide(r.id, "approved")}
                >
                  승인
                </button>
                <button
                  className="btn" style={{ flex: 1, height: 36, fontSize: 12.5, color: "var(--danger-strong)" }}
                  disabled={busyId === r.id}
                  onClick={() => setRejecting(r)}
                >
                  반려
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {rejecting && (
        <Modal
          onClose={() => setRejecting(null)}
          backdropBackground="rgba(20,22,30,.55)" backdropZIndex={80} panelZIndex={81}
          panelStyle={{ width: 340, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
        >
          <div style={{ padding: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>반려 사유</div>
            <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="반려 사유를 남겨주세요" style={{ minHeight: 80, resize: "vertical" }} />
            <div className="flex gap-2" style={{ marginTop: 12 }}>
              <button className="btn" style={{ flex: 1, height: 40 }} onClick={() => setRejecting(null)}>취소</button>
              <button className="btn" style={{ flex: 1, height: 40, background: "var(--danger-strong)", borderColor: "var(--danger-strong)", color: "#fff" }} onClick={() => decide(rejecting.id, "rejected", note)}>반려</button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
