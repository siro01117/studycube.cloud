"use client";

// 순찰 기록 화면의 "벌점 현황" 탭. 예전 전용 모듈(/m/penalty)의 대시보드·학생 목록·주 이동을 그대로
// 옮겼다 — 좌석 배치도(매일 쓰는 화면)엔 무거워서 안 두고, 순찰 담당자가 이미 드나드는 이 화면에
// 얹었다(순찰·벌점은 같은 사람이 같은 목적으로 보는 지표라 자연스럽다). 개별 학생 부여·삭제·추이는
// PenaltyDetailPanel(공용) 을 그대로 재사용 — 좌석 배치도 사이드 패널과 로직이 하나다.
import { useEffect, useMemo, useState } from "react";
import Modal from "../_shared/Modal";
import PenaltyDetailPanel from "../_shared/PenaltyDetailPanel";
import { getPenaltyOverview, type PenaltyOverview as OverviewData } from "../_shared/penaltyActions";
import { penaltyHeat, PENALTY_WARN } from "@/lib/penalty";
import { levelLabel } from "../student/util";

export default function PenaltyOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined); // undefined = 이번 주(서버가 정함)
  const [loadErr, setLoadErr] = useState(false);
  const [view, setView] = useState<"dash" | "list">("dash");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadErr(false);
    getPenaltyOverview(weekStart)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setLoadErr(true); });
    return () => { live = false; };
  }, [weekStart]);

  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.students].map((s) => ({ s, pts: data.weekly[s.id] ?? 0 })).sort((a, b) => b.pts - a.pts);
  }, [data]);
  const totalPoints = useMemo(() => (data ? Object.values(data.weekly).reduce((n, p) => n + Math.max(0, p), 0) : 0), [data]);
  const withPenalty = ranked.filter((r) => r.pts > 0).length;
  const warnCount = ranked.filter((r) => r.pts >= PENALTY_WARN).length;
  const detailStudent = data?.students.find((s) => s.id === detailId) ?? null;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter(({ s }) => s.name.toLowerCase().includes(needle) || String(s.seat_number ?? "").includes(needle) || levelLabel(s).toLowerCase().includes(needle));
  }, [ranked, q]);

  if (loadErr) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--sub)", fontSize: 13.5 }}>
        불러오지 못했습니다 · <button onClick={() => setWeekStart((w) => w)} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13.5 }}>다시 시도</button>
      </div>
    );
  }
  if (!data) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--sub)", fontSize: 13.5 }}>불러오는 중…</div>;
  }

  const weekWord = data.isCurrentWeek ? "이번 주" : `${data.weekLabel} 주`;
  const shiftWeek = (deltaWeeks: number) => {
    const [y, m, d] = data.weekStart.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + deltaWeeks * 7));
    setWeekStart(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="tabbar-scroll" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid var(--line)", flex: "none" }}>
        <ViewTab id="dash" label="대시보드" active={view} onPick={setView} />
        <ViewTab id="list" label="학생 목록" active={view} onPick={setView} />
        <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
          <button onClick={() => shiftWeek(-1)} className="chip" aria-label="이전 주" title="이전 주">‹</button>
          <span style={{ fontSize: 12, color: data.isCurrentWeek ? "var(--sub)" : "var(--accent)", fontWeight: data.isCurrentWeek ? 400 : 700, whiteSpace: "nowrap" }}>
            {data.isCurrentWeek ? `이번 주 ${data.weekLabel} ~` : `${data.weekLabel} ~ (지난 주)`}
          </span>
          {!data.isCurrentWeek && <button onClick={() => setWeekStart(undefined)} className="chip" style={{ fontWeight: 700, cursor: "pointer" }}>오늘로</button>}
          {data.isCurrentWeek ? (
            <span className="chip" aria-disabled style={{ opacity: 0.35, pointerEvents: "none" }}>›</span>
          ) : (
            <button onClick={() => shiftWeek(1)} className="chip" aria-label="다음 주" title="다음 주">›</button>
          )}
        </div>
      </div>

      {!data.isCurrentWeek && (
        <div style={{ flex: "none", padding: "8px 20px", background: "var(--accent-soft)", borderBottom: "1px solid var(--line)", fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textAlign: "center" }}>
          지난 주({data.weekLabel} ~) 기록을 보는 중입니다 — 벌점 부여는 좌석 배치도에서 학생을 눌러 이번 주로 줄 수 있습니다.
        </div>
      )}

      <div className="pad-mobile" style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {view === "dash" ? (
          <div style={{ maxWidth: 940, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="grid-collapse" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Stat label={`${weekWord} 총 벌점`} value={`${totalPoints}점`} tone="danger" />
              <Stat label="벌점 받은 학생" value={`${withPenalty}명`} />
              <Stat label={`주의 학생 (${PENALTY_WARN}점↑)`} value={`${warnCount}명`} tone={warnCount ? "danger" : undefined} />
            </div>

            <div className="grid-collapse" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>벌점 많은 학생</div>
                {ranked.filter((r) => r.pts > 0).length === 0 ? (
                  <div style={{ color: "var(--sub)", fontSize: 13, padding: "10px 0" }}>{weekWord} 벌점이 없습니다.</div>
                ) : ranked.filter((r) => r.pts > 0).slice(0, 8).map(({ s, pts }, i) => {
                  const h = penaltyHeat(pts);
                  return (
                    <button key={s.id} onClick={() => setDetailId(s.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 6px", border: "none", borderTop: i ? "1px solid var(--line)" : "none", background: "transparent", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                      <span style={{ width: 18, fontSize: 12, fontWeight: 800, color: "var(--sub)" }}>{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: s.seat_number != null ? "var(--accent)" : "var(--sub)", width: 26 }}>{s.seat_number ?? "—"}</span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{s.name}<span style={{ fontSize: 11.5, color: "var(--sub)", marginLeft: 6 }}>{levelLabel(s)}</span></span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: h.fg, background: h.bg, border: `1px solid ${h.bd}`, borderRadius: 8, padding: "2px 9px" }}>{pts}점</span>
                    </button>
                  );
                })}
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>사유별 분포</div>
                {data.breakdown.length === 0 ? (
                  <div style={{ color: "var(--sub)", fontSize: 13, padding: "10px 0" }}>기록이 없습니다.</div>
                ) : (() => {
                  const max = Math.max(...data.breakdown.map((b) => b.points));
                  return data.breakdown.map((b, i) => (
                    <div key={i} style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>
                          {b.label} <span style={{ color: "var(--sub)" }}>· {b.count}건</span>
                          {b.sessions != null && <span style={{ color: "var(--faint)" }}> · 순찰 {b.sessions}회 중 {b.count}회</span>}
                        </span>
                        <span style={{ fontWeight: 800, color: "var(--danger-strong-ink)" }}>{b.points}점</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: "var(--panel2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(b.points / max) * 100}%`, background: "var(--danger-strong)", borderRadius: 4 }} />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 좌석 · 학년 검색" style={{ height: 40, fontSize: 14, marginBottom: 12 }} />
            <div className="card" style={{ padding: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "48px 1fr 90px", gap: 10, padding: "6px 12px", fontSize: 11.5, color: "var(--sub)", fontWeight: 700 }}>
                <span>좌석</span><span>이름 · 학년</span><span style={{ textAlign: "right" }}>{weekWord}</span>
              </div>
              {list.map(({ s, pts }) => {
                const h = penaltyHeat(pts);
                return (
                  <button key={s.id} onClick={() => setDetailId(s.id)} style={{ display: "grid", gridTemplateColumns: "48px 1fr 90px", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", borderTop: "1px solid var(--line)", background: "transparent", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: s.seat_number != null ? "var(--accent)" : "var(--sub)" }}>{s.seat_number ?? "—"}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}<span style={{ fontSize: 12, color: "var(--sub)", marginLeft: 6 }}>{levelLabel(s)}</span></span>
                    <span style={{ justifySelf: "end", fontSize: 13, fontWeight: 800, color: h.fg, background: h.bg, border: `1px solid ${h.bd}`, borderRadius: 8, padding: "3px 10px", minWidth: 44, textAlign: "center" }}>{pts}점</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {detailStudent && (
        <Modal
          onClose={() => setDetailId(null)}
          backdropBackground="rgba(20,22,30,.45)"
          backdropZIndex={55}
          panelZIndex={56}
          ariaLabel={`${detailStudent.name} 벌점 상세`}
          panelStyle={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)", padding: 20 }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{detailStudent.name} <span style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 600 }}>{levelLabel(detailStudent)}</span></div>
            <button onClick={() => setDetailId(null)} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>
          <PenaltyDetailPanel
            studentId={detailStudent.id}
            canManage={data.canManage}
            canPatrolManage={data.canPatrolManage}
            today={data.today}
            weekStart={data.weekStart}
            isCurrentWeek={data.isCurrentWeek}
          />
        </Modal>
      )}
    </div>
  );
}

type PView = "dash" | "list";
function ViewTab({ id, label, active, onPick }: { id: PView; label: string; active: PView; onPick: (v: PView) => void }) {
  const on = active === id;
  return (
    <button onClick={() => onPick(id)} style={{ height: 34, padding: "0 15px", borderRadius: 9, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--sub)", fontWeight: on ? 800 : 500, fontSize: 13, cursor: "pointer" }}>{label}</button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--sub)" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: tone === "danger" ? "var(--danger-strong-ink)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}
