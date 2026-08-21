"use client";

// 스케쥴 입력 기간 관리 — ScheduleDemo.tsx 사이드바 "운영 시간표" 아래 항목에서 진입하는 독립 뷰.
// 세 구역: 입력 기간(지점 전체) · 개별 개방(학생 1명) · 제출 현황(재원생 전체, 지금 수정 가능한지).
// 학생 목록은 이미 page.tsx 에서 지점 전체를 한 번에 내려받은 걸(ScheduleDemo 의 students prop) 그대로
// 받아써 개별 개방의 학생 검색에 쓴다 — 별도 검색 API 없음(학생 수가 지점당 적어 클라 필터로 충분).
import { useEffect, useState } from "react";
import {
  listWindows, createWindow, deleteWindow,
  listGrants, createGrant, deleteGrant,
  listSubmissionStatus,
  type WindowRow, type GrantRow, type SubmissionStatusRow,
} from "./windowActions";
import type { SStudent } from "./ScheduleDemo";

const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 800, marginBottom: 4 };
const sectionDesc: React.CSSProperties = { fontSize: 12, color: "var(--faint)", marginBottom: 12 };
const th: React.CSSProperties = { textAlign: "left", padding: "7px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--faint)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--line)", verticalAlign: "middle" };

const statusChip: Record<"upcoming" | "active" | "ended", { label: string; fg: string; bg: string }> = {
  upcoming: { label: "예정", fg: "var(--sub)", bg: "var(--panel2)" },
  active: { label: "진행중", fg: "var(--accent)", bg: "var(--accent-soft)" },
  ended: { label: "종료", fg: "var(--faint)", bg: "var(--panel2)" },
};

function StatusChip({ status }: { status: "upcoming" | "active" | "ended" }) {
  const c = statusChip[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg }}>
      {c.label}
    </span>
  );
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10" /><path d="M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" />
      <path d="M4.5 4.5l.6 8a1.5 1.5 0 001.5 1.4h2.8a1.5 1.5 0 001.5-1.4l.6-8" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" /><path d="M13.5 13.5l-3-3" />
    </svg>
  );
}

export default function WindowView({ students }: { students: SStudent[] }) {
  return (
    <>
      <div className="card" style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>입력 기간</span>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>학생이 언제 스케쥴을 고칠 수 있는지 관리합니다</span>
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 18px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
        <WindowSection />
        <GrantSection students={students} />
        <StatusSection />
      </div>
    </>
  );
}

// ---------------- 입력 기간(지점 전체) ----------------
function WindowSection() {
  const [rows, setRows] = useState<WindowRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => { listWindows().then(setRows); };
  useEffect(reload, []);

  const add = async () => {
    setErr(null);
    setBusy(true);
    const fd = new FormData();
    fd.set("label", label);
    fd.set("opensAt", opensAt);
    fd.set("closesAt", closesAt);
    try {
      const row = await createWindow(fd);
      setRows((prev) => [row, ...(prev ?? [])]);
      setLabel(""); setOpensAt(""); setClosesAt("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const prev = rows;
    setRows((cur) => (cur ?? []).filter((r) => r.id !== id));
    try {
      await deleteWindow(id);
    } catch (e) {
      setRows(prev ?? null);
      setErr(e instanceof Error ? e.message : "삭제에 실패했습니다");
    }
  };

  return (
    <section>
      <div style={sectionTitle}>입력 기간</div>
      <div style={sectionDesc}>지점 전체 학생에게 열리는 기간입니다(예: 방학 → 개학 전환기).</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14, padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)" }}>
        <label style={{ flex: "1 1 140px", minWidth: 120 }}>
          <span className="label">라벨</span>
          <input className="input" style={{ height: 38 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 2학기 시간표" />
        </label>
        <label style={{ flex: "1 1 190px", minWidth: 170 }}>
          <span className="label">시작</span>
          <input className="input" style={{ height: 38 }} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 190px", minWidth: 170 }}>
          <span className="label">종료</span>
          <input className="input" style={{ height: 38 }} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </label>
        <button type="button" className="btn btn-accent" style={{ height: 38 }} disabled={busy || !opensAt || !closesAt} onClick={add}>
          추가
        </button>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600, marginBottom: 10 }}>{err}</div>}

      {rows == null ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>등록된 입력 기간이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>라벨</th><th style={th}>시작</th><th style={th}>종료</th><th style={th}>상태</th><th style={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.label || <span style={{ color: "var(--faint)" }}>(라벨 없음)</span>}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.opensLabel}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.closesLabel}</td>
                  <td style={td}><StatusChip status={r.status} /></td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button type="button" onClick={() => remove(r.id)} aria-label="삭제"
                      style={{ width: 28, height: 28, borderRadius: 8, display: "inline-grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--dim)", cursor: "pointer" }}>
                      <IconTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------- 개별 개방(학생 1명) ----------------
function GrantSection({ students }: { students: SStudent[] }) {
  const [rows, setRows] = useState<GrantRow[] | null>(null);
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => { listGrants().then(setRows); };
  useEffect(reload, []);

  const picked = students.find((s) => s.id === pickedId) ?? null;
  const matches = q.trim() && !picked ? students.filter((s) => s.name.includes(q.trim())).slice(0, 8) : [];

  const add = async () => {
    if (!pickedId) return;
    setErr(null);
    setBusy(true);
    const fd = new FormData();
    fd.set("studentId", pickedId);
    fd.set("opensAt", opensAt);
    fd.set("closesAt", closesAt);
    fd.set("note", note);
    try {
      const row = await createGrant(fd);
      setRows((prev) => [row, ...(prev ?? [])]);
      setPickedId(null); setQ(""); setOpensAt(""); setClosesAt(""); setNote("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const prev = rows;
    setRows((cur) => (cur ?? []).filter((r) => r.id !== id));
    try {
      await deleteGrant(id);
    } catch (e) {
      setRows(prev ?? null);
      setErr(e instanceof Error ? e.message : "회수에 실패했습니다");
    }
  };

  return (
    <section>
      <div style={sectionTitle}>개별 개방</div>
      <div style={sectionDesc}>입력 기간을 놓친 학생 1명에게만 별도로 열어줍니다.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)" }}>
        <div style={{ position: "relative" }}>
          <span className="label">학생</span>
          {picked ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 10px", border: "1px solid var(--accent)", borderRadius: 10, background: "var(--accent-soft)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>{picked.name}</span>
              {picked.seat_number != null && <span style={{ fontSize: 11.5, color: "var(--sub)" }}>{picked.seat_number}번</span>}
              <button type="button" onClick={() => setPickedId(null)} style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--sub)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                변경
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--dim)", pointerEvents: "none" }}><IconSearch /></span>
              <input className="input" style={{ height: 38, paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 검색" />
              {matches.length > 0 && (
                <div style={{ position: "absolute", zIndex: 5, top: 42, left: 0, right: 0, border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", boxShadow: "0 8px 24px rgba(20,22,30,.1)", overflow: "hidden" }}>
                  {matches.map((m) => (
                    <button key={m.id} type="button" onClick={() => { setPickedId(m.id); setQ(""); }}
                      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 10px", border: "none", background: "var(--card)", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                      {m.seat_number != null && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{m.seat_number}번</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 170px", minWidth: 160 }}>
            <span className="label">시작</span>
            <input className="input" style={{ height: 38 }} type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          </label>
          <label style={{ flex: "1 1 170px", minWidth: 160 }}>
            <span className="label">종료</span>
            <input className="input" style={{ height: 38 }} type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </label>
          <label style={{ flex: "2 1 180px", minWidth: 160 }}>
            <span className="label">메모</span>
            <input className="input" style={{ height: 38 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 여행으로 기간을 놓침" />
          </label>
          <button type="button" className="btn btn-accent" style={{ height: 38 }} disabled={busy || !pickedId || !opensAt || !closesAt} onClick={add}>
            개방
          </button>
        </div>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600, marginBottom: 10 }}>{err}</div>}

      {rows == null ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>개별 개방된 학생이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>학생</th><th style={th}>시작</th><th style={th}>종료</th><th style={th}>메모</th><th style={th}>상태</th><th style={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{r.studentName}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.opensLabel}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.closesLabel}</td>
                  <td style={{ ...td, color: "var(--sub)" }}>{r.note || "–"}</td>
                  <td style={td}><StatusChip status={r.status} /></td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button type="button" onClick={() => remove(r.id)} aria-label="회수"
                      style={{ width: 28, height: 28, borderRadius: 8, display: "inline-grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--dim)", cursor: "pointer" }}>
                      <IconTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------- 제출 현황(재원생 전체) ----------------
function StatusSection() {
  const [rows, setRows] = useState<SubmissionStatusRow[] | null>(null);
  useEffect(() => { listSubmissionStatus().then(setRows); }, []);

  const unsubmitted = rows?.filter((r) => !r.submitted).length ?? 0;

  return (
    <section>
      <div style={sectionTitle}>제출 현황</div>
      <div style={sectionDesc}>
        재원생 {rows?.length ?? 0}명
        {rows != null && unsubmitted > 0 && <span style={{ color: "var(--warn)", fontWeight: 700 }}> · 미제출 {unsubmitted}명</span>}
      </div>

      {rows == null ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)" }}>불러오는 중…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>학생</th><th style={th}>마지막 제출</th><th style={th}>지금 수정 가능</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {r.studentName}
                    {r.seatNumber != null && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, color: "var(--faint)" }}>{r.seatNumber}번</span>}
                  </td>
                  <td style={{ ...td, color: r.submitted ? "var(--sub)" : "var(--warn)", fontWeight: r.submitted ? 400 : 700, fontVariantNumeric: "tabular-nums" }}>
                    {r.lastSubmittedLabel ?? "미제출"}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.editable ? "var(--accent)" : "var(--faint)" }}>{r.reasonLabel}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
