"use client";

// 폰용 벌점 — 이번 주 누적 상위부터 리스트로 보고, 학생을 눌러 벌점을 준다.
// 데스크톱(좌석뷰·분포 차트)과 달리 "누가 위험한가 → 바로 부여"만 남긴다.
import { useMemo, useState, useTransition } from "react";
import MobileNav from "../_shared/MobileNav";
import { PENALTY_REASONS, PENALTY_WARN, penaltyHeat } from "@/lib/penalty";
import { givePenalty, getStudentPenaltyWeek } from "../m/penalty/actions";

export type PStudent = { id: string; name: string; grade: string | null; seat_number: number | null };
type Row = { id: string; label: string; points: number; at: string; source: "patrol" | "manual"; note: string | null };

export default function MobilePenalty({ students, weekly, weekLabel, canManage }: {
  students: PStudent[]; weekly: Record<string, number>; weekLabel: string; canManage: boolean;
}) {
  const [q, setQ] = useState("");
  const [onlyRisk, setOnlyRisk] = useState(false);
  const [sel, setSel] = useState<PStudent | null>(null);
  const [detail, setDetail] = useState<Row[] | null>(null);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };

  // 벌점 높은 순 — 폰에서는 "봐야 할 학생"이 위로 와야 한다(이름순은 PC에서).
  const list = useMemo(() => {
    const t = q.trim();
    return students
      .filter((s) => (!t || s.name.includes(t) || String(s.seat_number ?? "").includes(t)))
      .filter((s) => (!onlyRisk || (weekly[s.id] ?? 0) >= PENALTY_WARN))
      .sort((a, b) => (weekly[b.id] ?? 0) - (weekly[a.id] ?? 0) || a.name.localeCompare(b.name));
  }, [students, weekly, q, onlyRisk]);

  const riskCount = students.filter((s) => (weekly[s.id] ?? 0) >= PENALTY_WARN).length;
  const totalPts = Object.values(weekly).reduce((a, b) => a + b, 0);

  const openStudent = (s: PStudent) => {
    setSel(s); setDetail(null);
    start(async () => {
      setDetail(await getStudentPenaltyWeek(s.id));
    });
  };

  const give = (reason: string) => {
    if (!sel) return;
    const fd = new FormData();
    fd.set("studentId", sel.id); fd.set("reason", reason);
    start(async () => {
      await givePenalty(fd);
      setDetail(await getStudentPenaltyWeek(sel.id));
      say("벌점이 기록되었습니다");
    });
  };

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* 상단 */}
      <div style={{ flex: "none", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
          <MobileNav current="/penalty" />
          <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>벌점</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>{weekLabel} ~ · 월요일 리셋</div>
          </div>
          <span style={{ width: 40, flex: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 10px 10px" }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 좌석" style={{ height: 44, flex: 1 }} />
          <button onClick={() => setOnlyRisk((v) => !v)} className="chip"
            style={{ height: 44, padding: "0 14px", flex: "none", fontWeight: 700, background: onlyRisk ? "var(--danger)" : "var(--panel2)", color: onlyRisk ? "#fff" : "var(--sub)", border: `1px solid ${onlyRisk ? "var(--danger)" : "var(--line)"}` }}>
            주의 {riskCount}
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div style={{ flex: "none", display: "flex", gap: 8, padding: "10px 12px 4px" }}>
        <Tile label="이번 주 총 벌점" value={`${totalPts}점`} />
        <Tile label={`${PENALTY_WARN}점 이상`} value={`${riskCount}명`} tone={riskCount ? "warn" : undefined} />
      </div>

      {/* 학생 리스트 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 12px calc(16px + env(safe-area-inset-bottom))" }}>
        {list.length === 0 && <div style={{ textAlign: "center", color: "var(--faint)", fontSize: 13.5, padding: 30 }}>해당 학생이 없습니다.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((s) => {
            const p = weekly[s.id] ?? 0;
            const heat = penaltyHeat(p);
            return (
              <button key={s.id} onClick={() => openStudent(s)}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 14px", borderRadius: 14, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 42, fontSize: 12.5, fontWeight: 700, color: "var(--faint)", flex: "none" }}>{s.seat_number ?? "—"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15.5, fontWeight: 700 }}>{s.name}</span>
                  {s.grade && <span style={{ display: "block", fontSize: 12, color: "var(--faint)" }}>{s.grade}</span>}
                </span>
                <span style={{ minWidth: 52, textAlign: "center", padding: "6px 10px", borderRadius: 999, fontSize: 14, fontWeight: 800, background: heat.bg, border: `1px solid ${heat.bd}`, color: heat.fg }}>
                  {p}점
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 학생 시트 — 내역 + 부여 */}
      {sel && (
        <>
          <div onClick={() => setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))", maxHeight: "86dvh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 19, fontWeight: 800 }}>{sel.name}</span>
              {sel.seat_number != null && <span style={{ fontSize: 13, color: "var(--faint)" }}>{sel.seat_number}번</span>}
              <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, color: (weekly[sel.id] ?? 0) >= PENALTY_WARN ? "var(--danger)" : "var(--sub)" }}>이번 주 {weekly[sel.id] ?? 0}점</span>
            </div>

            {/* 이번 주 내역 */}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--faint)", marginBottom: 6 }}>이번 주 내역</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16, maxHeight: 160, overflowY: "auto" }}>
              {detail === null && <div style={{ fontSize: 13, color: "var(--faint)", padding: "6px 2px" }}>불러오는 중…</div>}
              {detail?.length === 0 && <div style={{ fontSize: 13, color: "var(--faint)", padding: "6px 2px" }}>기록 없음</div>}
              {detail?.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--panel2)", fontSize: 13 }}>
                  <span style={{ flex: 1, color: "var(--sub)" }}>{r.label}</span>
                  <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{r.source === "patrol" ? "순찰" : "수동"}</span>
                  <span style={{ fontWeight: 800, color: "var(--danger)" }}>+{r.points}</span>
                </div>
              ))}
            </div>

            {/* 부여 */}
            {canManage && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--faint)", marginBottom: 6 }}>벌점 주기</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                  {PENALTY_REASONS.map((r) => (
                    <button key={r.key} disabled={pending} onClick={() => give(r.key)}
                      style={{ minHeight: 54, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 11.5, color: "var(--danger)", fontWeight: 700 }}>+{r.points}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="btn" onClick={() => setSel(null)} style={{ height: 48, width: "100%", marginTop: 12 }}>닫기</button>
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 70, background: "var(--ink)", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 999, padding: "10px 18px" }}>{toast}</div>
      )}
    </main>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div style={{ flex: 1, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: tone === "warn" ? "var(--danger)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}
