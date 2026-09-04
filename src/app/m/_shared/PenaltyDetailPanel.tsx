"use client";

// 벌점 상세의 재사용 가능한 "속" — 학생 1명의 이번 주(또는 조회 중인 주) 벌점을 보여주고, 프리셋
// 사유로 주고, 항목을 지우고(+5초 실행취소), 최근 6주 추이를 그린다. 두 곳이 이 컴포넌트 하나를
// 그대로 가져다 쓴다: (1) 좌석 배치도 학생 상세의 벌점 사이드 패널(PenaltySidePanel), (2) 순찰 기록
// 화면 "벌점 현황" 탭에서 학생을 눌렀을 때 뜨는 상세 모달. 로직을 두 번 쓰지 않기 위해 뺐다 — 껍데기
// (위치·열고 닫는 방식)만 호출부마다 다르다.
import { useEffect, useRef, useState, useTransition } from "react";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { PENALTY_REASONS, penaltyHeat } from "@/lib/penalty";
import { weekDays, timeLabel } from "@/lib/date";
import { givePenalty, removePenalty, restorePenalty, getStudentPenaltyWeek, getStudentPenaltyTrend, type PenaltyTrendWeek } from "./penaltyActions";
import { removePatrolEvent, restorePatrolEvent } from "../seat/patrolActions";
import { useUndoToast } from "./UndoToast";

type DetailRow = {
  source: "patrol" | "manual"; id: string; label: string; points: number; note: string | null; at: string; date: string;
  reason?: string; state?: string; sessionId?: string | null; seatId?: string | null; createdBy?: string | null;
};

export default function PenaltyDetailPanel({
  studentId, canManage, canPatrolManage, today, weekStart, isCurrentWeek = true, onMenuOpenChange,
}: {
  studentId: string;
  canManage: boolean;       // penalty.manage — 부여·삭제
  canPatrolManage: boolean; // patrol.manage — 순찰 기인 행 삭제
  today: string;    // 서버 KST 오늘("YYYY-MM-DD")
  weekStart: string; // 조회할 주의 월요일
  isCurrentWeek?: boolean; // false면 지난 주 조회 전용 — 부여 버튼을 숨긴다(서버가 항상 오늘로 클램프해 화면과 어긋남 방지)
  onMenuOpenChange?: (open: boolean) => void; // 벌점 주기 메뉴가 열려 있는 동안엔 감싼 쪽(사이드 패널)이 Esc 를 가로채지 않게
}) {
  const [detail, setDetail] = useState<DetailRow[] | null>(null);
  const [trend, setTrend] = useState<PenaltyTrendWeek[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [selDay, setSelDay] = useState(isCurrentWeek ? today : weekDays(weekStart)[6].key);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [, start] = useTransition();
  const toast = useUndoToast();
  const idRef = useRef(studentId);
  idRef.current = studentId;
  const days = weekDays(weekStart);

  useEffect(() => { onMenuOpenChange?.(menu != null); }, [menu, onMenuOpenChange]);

  const load = () => {
    setLoadErr(false);
    const sid = studentId;
    getStudentPenaltyWeek(sid, weekStart)
      .then((rows) => { if (idRef.current === sid) setDetail(rows); })
      .catch(() => { if (idRef.current === sid) setLoadErr(true); });
    getStudentPenaltyTrend(sid, weekStart)
      .then((rows) => { if (idRef.current === sid) setTrend(rows); })
      .catch(() => { /* 추이는 부가 정보 — 실패해도 내역만 보이면 충분 */ });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelDay(isCurrentWeek ? today : days[6].key); load(); }, [studentId, weekStart]);

  const give = (reason: string) => {
    const fd = new FormData(); fd.set("studentId", studentId); fd.set("reason", reason); fd.set("date", selDay);
    start(async () => { await givePenalty(fd); load(); });
  };

  // 삭제 = 정정(원래 시각·부여자를 들고 있다가 토스트 "실행취소"로 그대로 복원).
  const removeRow = (row: DetailRow) => {
    const fd = new FormData(); fd.set("id", row.id);
    start(async () => {
      await (row.source === "patrol" ? removePatrolEvent(fd) : removePenalty(fd));
      load();
      toast.notify(`${row.label} 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", row.id); rfd.set("studentId", studentId); rfd.set("at", row.at); rfd.set("date", row.date);
        rfd.set("points", String(row.points)); rfd.set("createdBy", row.createdBy ?? "");
        if (row.source === "patrol") {
          rfd.set("state", row.state ?? ""); rfd.set("sessionId", row.sessionId ?? ""); rfd.set("seatId", row.seatId ?? "");
          start(async () => { await restorePatrolEvent(rfd); load(); });
        } else {
          rfd.set("reason", row.reason ?? ""); rfd.set("note", row.note ?? "");
          start(async () => { await restorePenalty(rfd); load(); });
        }
      });
    });
  };

  const giveMenuItems: MenuItem[] = PENALTY_REASONS.map((r) => ({ label: r.label, right: `+${r.points}`, onClick: () => give(r.key) }));
  const weekTotal = detail ? detail.reduce((n, r) => n + r.points, 0) : 0;
  const dayRows = detail ? detail.filter((r) => r.date === selDay) : [];
  const sd = days.find((d) => d.key === selDay);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="flex items-center justify-between">
        <div className="label" style={{ margin: 0 }}>
          {isCurrentWeek ? "이번 주" : `${weekStart} 주`} 누적 <span style={{ color: weekTotal > 0 ? "var(--danger-strong-ink)" : "var(--dim)", fontWeight: 800 }}>{weekTotal}점</span>
        </div>
      </div>

      {/* 최근 6주 추이 — 상습 여부(매주 반복되는지)는 이번 주 점수만으론 안 보인다 */}
      {trend && trend.some((w) => w.points > 0) && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 34 }}>
          {(() => {
            const maxT = Math.max(1, ...trend.map((w) => w.points));
            return trend.map((w) => {
              const on = w.weekStart === weekStart;
              const h = penaltyHeat(w.points);
              return (
                <div key={w.weekStart} title={`${w.weekStart} 주 · ${w.points}점`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ width: "100%", height: 24, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", height: `${Math.max(3, (w.points / maxT) * 24)}px`, borderRadius: 3, background: w.points > 0 ? h.fg : "var(--line)", opacity: w.points > 0 ? (on ? 1 : 0.55) : 0.4 }} />
                  </div>
                  <span style={{ fontSize: 8.5, fontWeight: on ? 800 : 500, color: on ? "var(--accent)" : "var(--faint)" }}>{w.points}</span>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* 요일 탭 */}
      <div style={{ display: "flex", gap: 3 }}>
        {days.map((d) => {
          const on = selDay === d.key;
          const future = d.key > today;
          const pts = detail ? detail.filter((r) => r.date === d.key).reduce((n, r) => n + r.points, 0) : 0;
          return (
            <button key={d.key} disabled={future} onClick={() => setSelDay(d.key)}
              style={{ flex: 1, minWidth: 0, padding: "4px 0", borderRadius: 8, border: `1px solid ${on ? "var(--accent)" : "transparent"}`, background: on ? "var(--accent-soft)" : "transparent", cursor: future ? "default" : "pointer", opacity: future ? 0.35 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, position: "relative" }}>
              <span style={{ fontSize: 11, fontWeight: on ? 800 : 600, color: on ? "var(--accent)" : d.key === today ? "var(--ink)" : "var(--sub)" }}>{d.wd}</span>
              <span style={{ fontSize: 9, color: "var(--sub)" }}>{d.dayNum}</span>
              {pts > 0 && <span style={{ position: "absolute", top: 2, right: "50%", marginRight: -10, width: 4, height: 4, borderRadius: "50%", background: "var(--danger-strong)" }} />}
            </button>
          );
        })}
      </div>

      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {loadErr ? (
          <div style={{ color: "var(--sub)", fontSize: 12.5, padding: "10px 2px", textAlign: "center" }}>
            불러오지 못했습니다 · <button onClick={load} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12.5 }}>다시 시도</button>
          </div>
        ) : detail === null ? (
          <div style={{ color: "var(--sub)", fontSize: 12.5, padding: "10px 2px", textAlign: "center" }}>불러오는 중…</div>
        ) : dayRows.length === 0 ? (
          <div style={{ color: "var(--sub)", fontSize: 12.5, padding: "10px 2px", textAlign: "center" }}>{selDay === today ? "오늘" : `${sd ? `${sd.dayNum}일(${sd.wd})` : selDay}`} 벌점 내역이 없습니다.</div>
        ) : (
          dayRows.map((r, i) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{r.label}{r.note ? <span style={{ color: "var(--sub)", fontWeight: 400 }}> · {r.note}</span> : null}</span>
              <span style={{ fontSize: 11, color: "var(--sub)" }}>{timeLabel(r.at)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger-strong-ink)", width: 26, textAlign: "right" }}>+{r.points}</span>
              {(r.source === "patrol" ? canPatrolManage : canManage) ? (
                <button onClick={() => removeRow(r)} aria-label={r.source === "patrol" ? "이 순찰 기록 삭제" : "이 벌점 삭제"} title={r.source === "patrol" ? "이 순찰 기록 삭제" : "이 벌점 삭제"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--faint)", width: 22, height: 22, display: "grid", placeItems: "center" }}>
                  <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              ) : <span style={{ width: 22 }} />}
            </div>
          ))
        )}
      </div>

      {canManage && isCurrentWeek && selDay >= weekStart && selDay <= today && (
        <button className="btn" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} style={{ width: "100%", height: 38, fontSize: 12.5, color: "var(--accent)", border: "1px solid rgba(79,70,229,.28)", background: "var(--accent-soft)" }}>
          + {selDay === today || !sd ? "벌점 주기" : `${sd.dayNum}일(${sd.wd}) 벌점 주기`}
        </button>
      )}

      {menu && canManage && (
        <ContextMenu x={menu.x} y={menu.y} header="벌점 주기" items={giveMenuItems} onClose={() => setMenu(null)} />
      )}

      {toast.element}
    </div>
  );
}
