"use client";

// 직원 근태 화면 — 날짜별 · 사람별 출퇴근 이벤트 목록 + 지각·조퇴 표시 + 손 정정.
// 폭 980 — 직원 일정(StaffScheduleView) 화면과 같은 값(집주인 확정폭 목록 참고, 이 모듈의 표
// 밀도가 그 화면과 비슷해 형제 화면 사이 폭 단차를 새로 만들지 않는다).
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import Modal from "../_shared/Modal";
import { clockLabel, parseClock } from "@/lib/staff-schedule";
import { correctAttendance, addManualAttendance, deleteAttendance } from "./attendanceActions";

export type AttEvent = {
  id: string;
  personId: string;
  kind: "in" | "out";
  at: string; // ISO
  timeLabel: string; // 서버가 KST 로 미리 포맷(HH:MM)
  source: "qr" | "manual";
  note: string | null;
  correctedByName: string | null;
};
export type PersonSummary = {
  personId: string;
  personName: string;
  events: AttEvent[];
  scheduleLabel: string | null; // "09:00~18:00" 또는 null(근무표 없음)
  judgement: "onTime" | "late" | "early" | "lateAndEarly" | "noSchedule" | "absent" | "notYet";
};

const JUDGE_LABEL: Record<PersonSummary["judgement"], string> = {
  onTime: "정상", late: "지각", early: "조퇴", lateAndEarly: "지각·조퇴", noSchedule: "근무표 없음",
  absent: "결근", notYet: "미기록",
};
// "결근"도 기존 warn(주황) 톤을 그대로 쓴다 — 새 배지 색을 만들지 않는다는 원칙(집주인 지시)에 따라,
// 이미 "정상이 아니니 봐야 한다"는 의미로 쓰던 warn 을 재사용한다. 텍스트 라벨("결근")로 지각·조퇴와
// 구분된다.
const JUDGE_TONE: Record<PersonSummary["judgement"], "ok" | "warn" | "muted"> = {
  onTime: "ok", late: "warn", early: "warn", lateAndEarly: "warn", noSchedule: "muted",
  absent: "warn", notYet: "muted",
};

const WIDTH = 980;

const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--sub)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "10px 12px", fontSize: 13.5, borderBottom: "1px solid var(--line)", verticalAlign: "top" };

function Badge({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const bg = tone === "ok" ? "var(--ok-soft)" : tone === "warn" ? "var(--warn-soft)" : "var(--panel2)";
  const fg = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--sub)";
  return <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: bg, color: fg }}>{children}</span>;
}

export default function AttendanceView({
  date, today, prevDate, nextDate, canManage, canViewAll, people, summaries, meId,
}: {
  date: string;
  today: string;
  prevDate: string;
  nextDate: string;
  canManage: boolean;
  canViewAll: boolean;
  people: { id: string; name: string }[]; // 수기 추가 대상 목록(전체 조회일 때만 의미 — 본인만 볼 땐 [본인])
  summaries: PersonSummary[];
  meId: string;
}) {
  const [, start] = useTransition();
  const [correcting, setCorrecting] = useState<AttEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isToday = date === today;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px 40px" }}>
      <div style={{ maxWidth: WIDTH, margin: "0 auto" }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link href={`/m/staff?section=attendance&date=${prevDate}`} className="chip" aria-label="전날" title="전날">‹</Link>
            <span style={{ fontSize: 13, fontWeight: isToday ? 700 : 800, color: isToday ? "var(--ink)" : "var(--accent)", whiteSpace: "nowrap" }}>
              {date}{isToday ? " (오늘)" : ""}
            </span>
            {!isToday && <Link href="/m/staff?section=attendance" className="chip" style={{ fontWeight: 700 }}>오늘로</Link>}
            {isToday ? (
              <span className="chip" aria-disabled style={{ opacity: 0.35, pointerEvents: "none" }}>›</span>
            ) : (
              <Link href={`/m/staff?section=attendance&date=${nextDate}`} className="chip" aria-label="다음날" title="다음날">›</Link>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canManage && (
              <Link href="/m/staff/attendance/kiosk" className="btn btn-accent" style={{ height: 36, padding: "0 14px", fontSize: 13, textDecoration: "none" }}>
                QR 화면 띄우기
              </Link>
            )}
            {canManage && (
              <button className="chip" onClick={() => setAdding(true)}>빠진 기록 추가</button>
            )}
          </div>
        </div>

        {err && <div style={{ marginBottom: 10, fontSize: 13, color: "var(--danger-strong)" }}>{err}</div>}

        {!canViewAll && (
          <div style={{ marginBottom: 10, fontSize: 12.5, color: "var(--sub)" }}>본인 출근부만 표시됩니다.</div>
        )}

        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>이름</th>
                <th style={th}>근무표</th>
                <th style={th}>기록</th>
                <th style={th}>판정</th>
                {canManage && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {summaries.length === 0 && (
                <tr><td style={{ ...td, color: "var(--faint)" }} colSpan={canManage ? 5 : 4}>기록이 없습니다.</td></tr>
              )}
              {summaries.map((row) => (
                <tr key={row.personId}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{row.personName}</td>
                  <td style={{ ...td, color: "var(--sub)", whiteSpace: "nowrap" }}>{row.scheduleLabel ?? "–"}</td>
                  <td style={td}>
                    {row.events.length === 0 ? (
                      <span style={{ color: "var(--faint)" }}>–</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {row.events.map((ev) => (
                          <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: ev.kind === "in" ? "var(--accent)" : "var(--sub)" }}>
                              {ev.kind === "in" ? "출근" : "퇴근"} {ev.timeLabel}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--faint)" }}>
                              {ev.source === "manual" ? "수기" : "QR"}
                              {ev.correctedByName ? ` · ${ev.correctedByName} 정정` : ""}
                            </span>
                            {canManage && (
                              <button className="chip" style={{ height: 20, padding: "0 8px", fontSize: 11 }} onClick={() => setCorrecting(ev)}>
                                정정
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={td}><Badge tone={JUDGE_TONE[row.judgement]}>{JUDGE_LABEL[row.judgement]}</Badge></td>
                  {canManage && <td style={td} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {correcting && (
        <CorrectModal
          event={correcting}
          date={date}
          onClose={() => setCorrecting(null)}
          onSubmit={(fd) => start(async () => {
            const r = await correctAttendance(fd);
            if (!r.ok) { setErr(r.error); return; }
            setErr(null);
            setCorrecting(null);
          })}
          onDelete={() => start(async () => {
            const fd = new FormData(); fd.set("id", correcting.id);
            const r = await deleteAttendance(fd);
            if (!r.ok) { setErr(r.error); return; }
            setErr(null);
            setCorrecting(null);
          })}
        />
      )}
      {adding && (
        <AddModal
          date={date}
          people={people}
          defaultPersonId={canViewAll ? (people[0]?.id ?? meId) : meId}
          onClose={() => setAdding(false)}
          onSubmit={(fd) => start(async () => {
            const r = await addManualAttendance(fd);
            if (!r.ok) { setErr(r.error); return; }
            setErr(null);
            setAdding(false);
          })}
        />
      )}
    </div>
  );
}

const inputStyle: CSSProperties = { width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, background: "var(--card)", color: "var(--ink)" };
const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 4, display: "block" };
const modalPanel: CSSProperties = { width: 360, maxWidth: "calc(100vw - 32px)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)", padding: 22 };

function CorrectModal({
  event, date, onClose, onSubmit, onDelete,
}: { event: AttEvent; date: string; onClose: () => void; onSubmit: (fd: FormData) => void; onDelete: () => void }) {
  const [kind, setKind] = useState<"in" | "out">(event.kind);
  const [time, setTime] = useState(event.timeLabel);
  const [note, setNote] = useState(event.note ?? "");
  const valid = parseClock(time) != null;

  return (
    <Modal onClose={onClose} backdropBackground="rgba(20,22,30,.45)" backdropZIndex={90} panelZIndex={91} panelStyle={modalPanel} ariaLabel="출근부 정정">
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>출근부 정정</h2>
      <div style={{ marginBottom: 12 }}>
        <span style={labelStyle}>구분</span>
        <div style={{ display: "flex", gap: 8 }}>
          {(["in", "out"] as const).map((k) => (
            <button key={k} type="button" className="chip" onClick={() => setKind(k)}
              style={{ fontWeight: kind === k ? 800 : 500, color: kind === k ? "var(--accent)" : "var(--sub)", borderColor: kind === k ? "var(--accent)" : "var(--line)" }}>
              {k === "in" ? "출근" : "퇴근"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>시각 (HH:MM)</label>
        <input style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} placeholder="09:00" onBlur={(e) => { const m = parseClock(e.currentTarget.value); if (m != null) setTime(clockLabel(m)); }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>메모</label>
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="정정 사유(선택)" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button type="button" className="chip" style={{ color: "var(--danger-strong)" }} onClick={onDelete}>삭제</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="chip" onClick={onClose}>취소</button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!valid}
            style={{ height: 34, padding: "0 14px", fontSize: 13, opacity: valid ? 1 : 0.5 }}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", event.id); fd.set("date", date); fd.set("kind", kind); fd.set("time", time); fd.set("note", note);
              onSubmit(fd);
            }}
          >
            저장
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({
  date, people, defaultPersonId, onClose, onSubmit,
}: { date: string; people: { id: string; name: string }[]; defaultPersonId: string; onClose: () => void; onSubmit: (fd: FormData) => void }) {
  const [personId, setPersonId] = useState(defaultPersonId);
  const [kind, setKind] = useState<"in" | "out">("in");
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const valid = parseClock(time) != null && !!personId;

  return (
    <Modal onClose={onClose} backdropBackground="rgba(20,22,30,.45)" backdropZIndex={90} panelZIndex={91} panelStyle={modalPanel} ariaLabel="빠진 출근부 추가">
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>빠진 기록 추가</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>직원</label>
        {people.length > 1 ? (
          <select style={inputStyle} value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : (
          <div style={{ ...inputStyle, background: "var(--panel2)" }}>{people[0]?.name ?? "–"}</div>
        )}
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={labelStyle}>구분</span>
        <div style={{ display: "flex", gap: 8 }}>
          {(["in", "out"] as const).map((k) => (
            <button key={k} type="button" className="chip" onClick={() => setKind(k)}
              style={{ fontWeight: kind === k ? 800 : 500, color: kind === k ? "var(--accent)" : "var(--sub)", borderColor: kind === k ? "var(--accent)" : "var(--line)" }}>
              {k === "in" ? "출근" : "퇴근"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>시각 (HH:MM)</label>
        <input style={inputStyle} value={time} onChange={(e) => setTime(e.target.value)} onBlur={(e) => { const m = parseClock(e.currentTarget.value); if (m != null) setTime(clockLabel(m)); }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>메모</label>
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 찍는 걸 잊음(선택)" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="chip" onClick={onClose}>취소</button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={!valid}
          style={{ height: 34, padding: "0 14px", fontSize: 13, opacity: valid ? 1 : 0.5 }}
          onClick={() => {
            const fd = new FormData();
            fd.set("personId", personId); fd.set("date", date); fd.set("kind", kind); fd.set("time", time); fd.set("note", note);
            onSubmit(fd);
          }}
        >
          추가
        </button>
      </div>
    </Modal>
  );
}
