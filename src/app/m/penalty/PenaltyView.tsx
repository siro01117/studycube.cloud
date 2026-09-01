"use client";

// 벌점 모듈. 대시보드 / 좌석 배치도 / 학생 목록 3뷰. 이번 주 누적(순찰+수동, 월요일 리셋).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import ContextMenu, { type MenuItem } from "../_shared/ContextMenu";
import FitBox from "../_shared/FitBox";
import Modal from "../_shared/Modal";
import { levelLabel } from "../student/util";
import { PENALTY_REASONS, penaltyHeat, PENALTY_WARN } from "@/lib/penalty";
import { weekDays, addDays } from "@/lib/date";
import { givePenalty, removePenalty, restorePenalty, getStudentPenaltyWeek, getStudentPenaltyTrend, type PenaltyTrendWeek } from "./actions";
import { removePatrolEvent, restorePatrolEvent } from "../seat/patrolActions";
import { useUndoToast } from "../_shared/UndoToast";

export type PRoom = { id: string; name: string; floor: number };
export type PSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string; current_student_id: string | null };
export type PStudent = { id: string; name: string; level: string | null; grade: string | null; is_repeat: boolean | null; seat_number: number | null };
// sessions = 그 주 지점 순찰 세션 수(patrol 기인 항목에만 존재) — count(=M) 옆의 분모(N)로 표시.
export type Breakdown = { label: string; points: number; count: number; sessions?: number };
type DetailRow = {
  source: "patrol" | "manual"; id: string; label: string; points: number; note: string | null; at: string; date: string;
  reason?: string; // manual 전용 — 복원(실행취소) 시 PENALTY_BY_KEY 조회용 원시 사유 키
  state?: string; // patrol 전용 — 복원 시 PATROL_BY_KEY 조회용 원시 상태 키
  sessionId?: string | null; seatId?: string | null; createdBy?: string | null;
};

const SW = 82, SH = 60, CELL_X = 100, CELL_Y = 80, ORIGIN = 40, PER_ROW = 6;
const xyOf = (s: PSeat, i: number) => ({
  x: s.grid_x == null ? ORIGIN + (i % PER_ROW) * CELL_X : s.grid_x,
  y: s.grid_y == null ? ORIGIN + Math.floor(i / PER_ROW) * CELL_Y : s.grid_y,
});
const boundsOf = (pts: { x: number; y: number }[]) =>
  !pts.length ? { w: 260, h: 160 } : { w: Math.max(...pts.map((p) => p.x + SW)) + 32, h: Math.max(...pts.map((p) => p.y + SH)) + 32 };
const fmtTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function PenaltyView({
  rooms, seats, students, weekly, breakdown, weekLabel, weekStart, isCurrentWeek, today, canManage, canPatrolManage,
}: {
  rooms: PRoom[]; seats: PSeat[]; students: PStudent[];
  weekly: Record<string, number>; breakdown: Breakdown[]; weekLabel: string; weekStart: string; isCurrentWeek: boolean; today: string; canManage: boolean; canPatrolManage: boolean;
}) {
  const [view, setView] = useState<"dash" | "seats" | "list">("dash");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; studentId: string; name: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailRow[] | null>(null);
  const [trend, setTrend] = useState<PenaltyTrendWeek[] | null>(null); // 최근 6주 추이(상세 모달, 상습 여부 판단용)
  const [loadErr, setLoadErr] = useState(false); // 상세 로드 실패 → 무한 로딩 대신 재시도 안내
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  // 상세 팝업 선택 요일 — 지금 보고 있는 주가 이번 주면 오늘(서버 KST), 지난 주면 그 주 마지막 날짜.
  const defaultDay = useMemo(() => (isCurrentWeek ? today : days[days.length - 1]?.key ?? today), [isCurrentWeek, today, days]);
  const [selDay, setSelDay] = useState<string>(defaultDay);
  const [, start] = useTransition();
  const toast = useUndoToast();
  const todayKey = today;

  const nameOf = useMemo(() => { const m = new Map<string, string>(); for (const s of students) m.set(s.id, s.name); return m; }, [students]);
  const seatsByRoom = useMemo(() => {
    const m = new Map<string, PSeat[]>();
    for (const s of seats) { if (!s.room_id) continue; (m.get(s.room_id) ?? m.set(s.room_id, []).get(s.room_id)!).push(s); }
    return m;
  }, [seats]);
  const floors = useMemo(() => Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b), [rooms]);

  const ranked = useMemo(() => [...students].map((s) => ({ s, pts: weekly[s.id] ?? 0 })).sort((a, b) => b.pts - a.pts), [students, weekly]);
  const totalPoints = useMemo(() => Object.values(weekly).reduce((n, p) => n + Math.max(0, p), 0), [weekly]);
  const withPenalty = ranked.filter((r) => r.pts > 0).length;
  const warnCount = ranked.filter((r) => r.pts >= PENALTY_WARN).length;
  const detailStudent = students.find((s) => s.id === detailId) ?? null;
  const detailRef = useRef<string | null>(detailId);
  detailRef.current = detailId;

  useEffect(() => {
    if (!detailId) { setDetail(null); setTrend(null); setLoadErr(false); return; }
    setSelDay(defaultDay); // 열 때 보고 있는 주에 맞는 기본 요일로
    setLoadErr(false);
    getStudentPenaltyWeek(detailId, weekStart)
      .then((rows) => { if (detailRef.current === detailId) setDetail(rows); })
      .catch(() => { if (detailRef.current === detailId) setLoadErr(true); });
    getStudentPenaltyTrend(detailId, weekStart)
      .then((rows) => { if (detailRef.current === detailId) setTrend(rows); })
      .catch(() => { /* 추이는 부가 정보 — 실패해도 상세 내역만 보이면 충분, 별도 에러 UI 없음 */ });
  }, [detailId, weekStart, defaultDay]);

  // 응답이 늦게 와도 지금 열린 학생이 아니면 무시(레이스 방지)
  const reloadDetail = () => {
    const id = detailId;
    if (!id) return;
    setLoadErr(false);
    getStudentPenaltyWeek(id, weekStart)
      .then((rows) => { if (detailRef.current === id) setDetail(rows); })
      .catch(() => { if (detailRef.current === id) setLoadErr(true); });
    getStudentPenaltyTrend(id, weekStart)
      .then((rows) => { if (detailRef.current === id) setTrend(rows); })
      .catch(() => {});
  };
  const give = (studentId: string, reason: string) => {
    const fd = new FormData(); fd.set("studentId", studentId); fd.set("reason", reason); fd.set("date", selDay);
    start(async () => { await givePenalty(fd); reloadDetail(); });
  };
  // 내역 항목 삭제로 정정 (누적 = 내역 합산). 순찰 항목은 patrol_event, 수동은 penalty_event 삭제.
  // 확인창 없이 즉시 지우는 대신, 삭제 전 행 내용을 그대로 들고 있다가 토스트 "실행취소"로 같은
  // id·시각·부여자로 다시 기록한다(원래 시각이 보존돼야 정정 이력이 어긋나지 않는다).
  const removeRow = (row: DetailRow) => {
    const studentId = detailStudent?.id;
    const fd = new FormData(); fd.set("id", row.id);
    start(async () => {
      await (row.source === "patrol" ? removePatrolEvent(fd) : removePenalty(fd));
      reloadDetail();
      if (!studentId) return;
      toast.notify(`${row.label} 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", row.id);
        rfd.set("studentId", studentId);
        rfd.set("at", row.at);
        rfd.set("date", row.date);
        rfd.set("points", String(row.points));
        rfd.set("createdBy", row.createdBy ?? "");
        if (row.source === "patrol") {
          rfd.set("state", row.state ?? "");
          rfd.set("sessionId", row.sessionId ?? "");
          rfd.set("seatId", row.seatId ?? "");
          start(async () => { await restorePatrolEvent(rfd); reloadDetail(); });
        } else {
          rfd.set("reason", row.reason ?? "");
          rfd.set("note", row.note ?? "");
          start(async () => { await restorePenalty(rfd); reloadDetail(); });
        }
      });
    });
  };

  const giveMenuItems = (studentId: string): MenuItem[] =>
    PENALTY_REASONS.map((r) => ({
      label: r.label,
      right: `+${r.points}`,
      onClick: () => give(studentId, r.key),
    }));

  // "이번 주" 문구를 화면 곳곳에서 재사용 — 지난 주를 보는 중엔 그 사실이 늘 드러나야 한다.
  const weekWord = isCurrentWeek ? "이번 주" : `${weekLabel} 주`;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter(({ s }) => s.name.toLowerCase().includes(needle) || String(s.seat_number ?? "").includes(needle) || levelLabel(s).toLowerCase().includes(needle));
  }, [ranked, q]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* 뷰 전환 */}
      <div className="tabbar-scroll" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid var(--line)", flex: "none" }}>
        <ViewTab id="dash" label="대시보드" active={view} onPick={setView} />
        <ViewTab id="seats" label="좌석 배치도" active={view} onPick={setView} />
        <ViewTab id="list" label="학생 목록" active={view} onPick={setView} />
        <span className="hide-mobile" style={{ marginLeft: "auto", fontSize: 12, color: isCurrentWeek ? "var(--sub)" : "var(--accent)", fontWeight: isCurrentWeek ? 400 : 700 }}>
          {isCurrentWeek ? `이번 주 ${weekLabel} ~` : `${weekLabel} ~ (지난 주)`}
        </span>
      </div>

      {!isCurrentWeek && (
        <div style={{ flex: "none", padding: "8px 20px", background: "var(--accent-soft)", borderBottom: "1px solid var(--line)", fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textAlign: "center" }}>
          지난 주({weekLabel} ~) 기록을 보는 중입니다 — 벌점 부여는 이번 주로 돌아가야 가능합니다.
        </div>
      )}

      <div className="pad-mobile" style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {view === "dash" ? (
          <div style={{ maxWidth: 940, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* 통계 카드 */}
            <div className="grid-collapse" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Stat label={`${weekWord} 총 벌점`} value={`${totalPoints}점`} tone="danger" />
              <Stat label="벌점 받은 학생" value={`${withPenalty}명`} />
              <Stat label={`주의 학생 (${PENALTY_WARN}점↑)`} value={`${warnCount}명`} tone={warnCount ? "danger" : undefined} />
            </div>

            <div className="grid-collapse" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* TOP */}
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

              {/* 사유별 분포 */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>사유별 분포</div>
                {breakdown.length === 0 ? (
                  <div style={{ color: "var(--sub)", fontSize: 13, padding: "10px 0" }}>기록이 없습니다.</div>
                ) : (() => {
                  const max = Math.max(...breakdown.map((b) => b.points));
                  return breakdown.map((b, i) => (
                    <div key={i} style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>
                          {b.label} <span style={{ color: "var(--sub)" }}>· {b.count}건</span>
                          {/* 순찰 기인 항목만 분모(N=이 주 지점 순찰 세션 수)를 함께 보여 — 직원마다 순찰
                              횟수가 달라도(순찰 편차) 몇 건인지만으론 왜곡되게 읽히지 않도록. */}
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
        ) : view === "seats" ? (
          <>
            {/* 범례 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 16, fontSize: 11.5, color: "var(--dim)" }}>
              {[["0점", 0], ["1–2점", 2], [`3–${PENALTY_WARN - 1}점`, 3], [`${PENALTY_WARN}점↑`, PENALTY_WARN]].map(([lbl, p]) => {
                const h = penaltyHeat(p as number);
                return <span key={lbl as string} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: h.bg, border: `1px solid ${h.bd}` }} />{lbl}</span>;
              })}
              <span style={{ color: "var(--sub)" }}>· 좌석 클릭 = 상세{canManage ? "·벌점" : ""}</span>
            </div>
            {floors.map((fl) => (
              <div key={fl} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--sub)", marginBottom: 8 }}>{fl}층</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                  {rooms.filter((r) => r.floor === fl).map((room) => {
                    const rs = seatsByRoom.get(room.id) ?? [];
                    const pos = rs.map((s, i) => ({ s, ...xyOf(s, i) }));
                    const { w, h } = boundsOf(pos);
                    return (
                      <div key={room.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 12, background: "var(--card)", minWidth: 0, flex: "1 1 auto" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{room.name}</div>
                        <FitBox w={w} h={h}>
                        <div role="group" aria-label={`${room.name} 좌석 배치도`} style={{ position: "relative", width: w, height: h }}>
                          {pos.map(({ s, x, y }) => {
                            const sid = s.current_student_id;
                            const who = sid ? nameOf.get(sid) ?? null : null;
                            const known = !!(sid && who); // 재원생만 표시·상호작용(휴원/미상 학생은 공석 취급)
                            const pts = known ? weekly[sid!] ?? 0 : 0;
                            const heat = penaltyHeat(pts);
                            const style: CSSProperties = {
                              position: "absolute", left: x, top: y, width: SW, height: SH, borderRadius: 12,
                              border: `1.5px solid ${known ? heat.bd : "var(--line)"}`, background: known ? heat.bg : "var(--panel2)",
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                              cursor: known ? "pointer" : "default", overflow: "hidden",
                            };
                            const seatLabel = `${s.number ?? s.label}번`;
                            const ariaLabel = known ? `${seatLabel} ${who}, ${weekWord} ${pts}점` : `${seatLabel} 공석`;
                            return (
                              <div
                                key={s.id}
                                className="touchable"
                                onClick={known ? () => setDetailId(sid!) : undefined}
                                style={style}
                                role={known ? "button" : undefined}
                                tabIndex={known ? 0 : undefined}
                                aria-label={known ? ariaLabel : undefined}
                                onKeyDown={known ? (e) => {
                                  if (e.key !== "Enter" && e.key !== " ") return;
                                  e.preventDefault();
                                  setDetailId(sid!);
                                } : undefined}
                              >
                                <span style={{ position: "absolute", top: 3, left: 6, fontSize: 9.5, fontWeight: 700, color: "var(--sub)" }}>{s.number ?? s.label}</span>
                                {who ? (
                                  <>
                                    <span style={{ fontSize: 12.5, fontWeight: 700, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: heat.fg }}>{pts > 0 ? `${pts}점` : "—"}</span>
                                  </>
                                ) : <span style={{ fontSize: 11, color: "var(--sub)" }}>공석</span>}
                              </div>
                            );
                          })}
                        </div>
                        </FitBox>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
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

      {/* 벌점 주기 메뉴 */}
      {menu && canManage && (
        <ContextMenu x={menu.x} y={menu.y} header={`${menu.name} — 벌점 주기`} items={giveMenuItems(menu.studentId)} onClose={() => setMenu(null)} />
      )}

      {/* 학생 벌점 상세 */}
      {detailStudent && (
        <Modal
          onClose={() => setDetailId(null)}
          backdropBackground="rgba(20,22,30,.45)"
          backdropZIndex={55}
          panelZIndex={56}
          panelStyle={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflow: "hidden", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)", display: "flex", flexDirection: "column" }}
        >
            <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", flex: "none" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{detailStudent.name} <span style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 600 }}>{levelLabel(detailStudent)}</span></div>
                {(() => { const v = detail ? detail.reduce((n, r) => n + r.points, 0) : (isCurrentWeek ? weekly[detailStudent.id] ?? 0 : 0); return (
                  <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{isCurrentWeek ? "이번 주" : `${weekLabel} 주`} 누적 <b style={{ color: v > 0 ? "var(--danger-strong-ink)" : "var(--dim)" }}>{v}점</b></div>
                ); })()}
              </div>
              <button onClick={() => setDetailId(null)} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}>✕</button>
            </div>
            {/* 최근 6주 추이 — 상습 여부는 한 주 점수만으론 안 보인다(매주 반복되는지가 핵심). */}
            {trend && trend.some((w) => w.points > 0) && (
              <div style={{ padding: "10px 22px", borderBottom: "1px solid var(--line)", flex: "none" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", marginBottom: 6 }}>최근 6주 추이</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 40 }}>
                  {(() => {
                    const maxT = Math.max(1, ...trend.map((w) => w.points));
                    return trend.map((w) => {
                      const on = w.weekStart === weekStart;
                      const h = penaltyHeat(w.points);
                      return (
                        <div key={w.weekStart} title={`${w.weekStart} 주 · ${w.points}점`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <div style={{ width: "100%", height: 28, display: "flex", alignItems: "flex-end" }}>
                            <div style={{ width: "100%", height: `${Math.max(3, (w.points / maxT) * 28)}px`, borderRadius: 3, background: w.points > 0 ? h.fg : "var(--line)", opacity: w.points > 0 ? (on ? 1 : 0.55) : 0.4 }} />
                          </div>
                          <span style={{ fontSize: 9, fontWeight: on ? 800 : 500, color: on ? "var(--accent)" : "var(--faint)" }}>{w.points}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
            {/* 요일 선택 (조회 중인 주) */}
            <div style={{ display: "flex", gap: 3, padding: "10px 12px", borderBottom: "1px solid var(--line)", flex: "none" }}>
              {days.map((d) => {
                const on = selDay === d.key;
                const future = d.key > todayKey;
                const dayPts = detail ? detail.filter((r) => r.date === d.key).reduce((n, r) => n + r.points, 0) : 0;
                return (
                  <button key={d.key} disabled={future} onClick={() => setSelDay(d.key)}
                    style={{ flex: 1, minWidth: 0, padding: "5px 0", borderRadius: 9, border: `1px solid ${on ? "var(--accent)" : "transparent"}`, background: on ? "var(--accent-soft)" : "transparent", cursor: future ? "default" : "pointer", opacity: future ? 0.35 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, position: "relative" }}>
                    <span style={{ fontSize: 12, fontWeight: on ? 800 : 600, color: on ? "var(--accent)" : d.key === todayKey ? "var(--ink)" : "var(--sub)" }}>{d.wd}</span>
                    <span style={{ fontSize: 9.5, color: "var(--sub)" }}>{d.dayNum}</span>
                    {dayPts > 0 && <span style={{ position: "absolute", top: 3, right: "50%", marginRight: -12, width: 5, height: 5, borderRadius: "50%", background: "var(--danger-strong)" }} />}
                  </button>
                );
              })}
            </div>

            <div style={{ overflowY: "auto", padding: 16, flex: 1 }}>
              {loadErr ? (
                <div style={{ color: "var(--sub)", fontSize: 13, padding: 16, textAlign: "center" }}>
                  불러오지 못했습니다 · <button onClick={reloadDetail} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>다시 시도</button>
                </div>
              ) : detail === null ? (
                <div style={{ color: "var(--sub)", fontSize: 13, padding: 12, textAlign: "center" }}>불러오는 중…</div>
              ) : (() => {
                const dayRows = detail.filter((r) => r.date === selDay);
                if (dayRows.length === 0) return <div style={{ color: "var(--sub)", fontSize: 13, padding: 16, textAlign: "center" }}>{selDay === todayKey ? "오늘" : `${selDay.slice(5).replace("-", "월 ")}일`} 벌점 내역이 없습니다.</div>;
                return (<>
                  {dayRows.map((r, i) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{r.label}{r.note ? <span style={{ color: "var(--sub)", fontWeight: 400 }}> · {r.note}</span> : null}</span>
                      <span style={{ fontSize: 11.5, color: "var(--sub)" }}>{fmtTime(r.at)}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--danger-strong-ink)", width: 30, textAlign: "right" }}>+{r.points}</span>
                      {/* 순찰 행 삭제는 서버가 patrol.manage 를 요구 → 권한 없으면 버튼을 숨겨 조용한 실패 방지 */}
                      {(r.source === "patrol" ? canPatrolManage : canManage) ? (
                        <button onClick={() => removeRow(r)} aria-label={r.source === "patrol" ? "이 순찰 기록 삭제" : "이 벌점 삭제"} title={r.source === "patrol" ? "이 순찰 기록 삭제" : "이 벌점 삭제"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--faint)", width: 24, height: 24, display: "grid", placeItems: "center" }}>
                          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}><path d="M6 6l12 12M18 6L6 18" /></svg>
                        </button>
                      ) : <span style={{ width: 24 }} />}
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px 2px", borderTop: "2px solid var(--line)", marginTop: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)", flex: 1 }}>이 날 합계</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "var(--danger-strong-ink)" }}>{dayRows.reduce((n, r) => n + r.points, 0)}점</span>
                    <span style={{ width: 24 }} />
                  </div>
                </>);
              })()}
            </div>
            {/* 벌점 부여는 항상 "오늘/이번 주" 기준(actions.ts) — 지난 주를 보는 중엔 새로 줄 수 없어 숨긴다
                (허용하면 서버가 조용히 오늘 날짜로 덮어써 화면과 실제 기록이 어긋난다). 조회 전용. */}
            {canManage && isCurrentWeek && (() => {
              const sd = days.find((d) => d.key === selDay);
              return (
                <div style={{ padding: 14, borderTop: "1px solid var(--line)", flex: "none" }}>
                  <button className="btn btn-accent" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, studentId: detailStudent.id, name: detailStudent.name })} style={{ width: "100%", height: 44 }}>
                    + {selDay === todayKey || !sd ? "벌점 주기" : `${sd.dayNum}일(${sd.wd}) 벌점 주기`}
                  </button>
                </div>
              );
            })()}
        </Modal>
      )}

      {toast.element}
    </div>
  );
}

// 뷰 전환 탭 — 렌더 바디 밖(모듈 스코프)에 두어 리렌더마다 재마운트되지 않게.
type PView = "dash" | "seats" | "list";
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
