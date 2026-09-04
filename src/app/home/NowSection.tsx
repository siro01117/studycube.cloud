"use client";

// 홈(=대시보드)의 "지금" 카드 그리드 — 실시간 학원 상황. 최초 렌더는 page.tsx 가 준 initial 을
// 그대로 쓰고, 그 뒤로는 getNowSnapshot() 서버 액션을 폴링해 이 섹션만 갱신한다(모듈 격자가 없어진
// 자리라 페이지 전체가 이 섹션 하나 — 그래도 폴링은 이 컴포넌트로 격리해 헤더·트렌드까지 다시
// 그리지 않는다).
//
// 폴링 주기 30초: 예전 관리자 전용 대시보드(20초)보다 늦춘 이유는 이제 "홈"이라 전 직원이 여는
// 화면이라 동시 접속이 훨씬 많아지기 때문 — 순찰·출결이 분 단위로 의미 있는 정보인 걸 감안하면
// 30초도 충분히 실시간이다(부담과 실시간성의 절충, report 참고). 탭이 안 보이면 건너뛰고, 복귀 시
// 즉시 1회 갱신.
//
// patrolPeople(관리자별 순찰 편차, 최근 4주)은 page.tsx 가 한 번만 준 정적 값이다 — 폴링 대상인
// NowSnapshot 에는 없다. "마지막 순찰 이후"·"오늘 몇 회"와 같은 질문이라 renderPatrol() 안에서
// 같은 카드로 합친다(집주인 지시 — 예전엔 "최근 흐름" 트렌드 스트립에 따로 있었다).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { getNowSnapshot, type NowSnapshot } from "./nowActions";
import { PATROL_BY_KEY } from "@/lib/patrol";
import { solid } from "@/lib/semantic-color";

const POLL_MS = 30_000;

const ic = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Card({ children, tone }: { children: ReactNode; tone?: "danger" | "warn" }) {
  const border = tone === "danger" ? "var(--danger-strong)" : tone === "warn" ? "var(--warn)" : "var(--line)";
  return (
    <div className="card" style={{ padding: "18px 20px", borderLeft: tone ? `3px solid ${border}` : undefined }}>
      {children}
    </div>
  );
}

function CardHead({ icon, title, tone }: { icon: ReactNode; title: string; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "var(--danger-strong)" : tone === "warn" ? "var(--warn)" : "var(--sub)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ color, display: "flex" }}><svg {...ic}>{icon}</svg></span>
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--faint)" }}>{children}</div>;
}

export default function NowSection({ initial, patrolPeople }: { initial: NowSnapshot; patrolPeople: { name: string; n: number }[] | null }) {
  const [snap, setSnap] = useState(initial);
  const [secsAgo, setSecsAgo] = useState<number | null>(null);
  const fetchedAtMsRef = useRef<number>(Date.now());
  const inFlight = useRef(false);

  const refresh = async () => {
    if (inFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const next = await getNowSnapshot();
      setSnap(next);
      fetchedAtMsRef.current = Date.now();
      setSecsAgo(0);
    } catch {
      // 폴링 실패는 조용히 무시 — 화면을 에러로 덮지 않는다, 다음 주기에 재시도.
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSecsAgo(Math.floor((Date.now() - fetchedAtMsRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const { patrol, seats, tasks } = snap;

  // ---- 우선도 점수 — 급한 것이 위(왼쪽 위)로. 순찰·오늘 남은 일은 이제 고정된 상단 한 쌍이라
  // 이 점수 경쟁에서 뺐다(아래 참고). 나머지(주의해야 할 학생·재실 현황) 둘 사이의 순서만
  // 여기서 정한다. ----
  const flaggedScore = !patrol ? -1 : patrol.flagged.length > 0 ? Math.min(95, 55 + patrol.flagged.length * 10) : 0;
  const occScore = !seats ? -1 : seats.noShow.length > 0 ? Math.min(70, 35 + seats.noShow.length * 5) : 15;

  const restSections: { key: string; score: number; node: ReactNode }[] = [
    ...(patrol ? [{ key: "flagged", score: flaggedScore, node: renderFlagged() }] : []),
    ...(seats ? [{ key: "occ", score: occScore, node: renderOccupancy() }] : []),
  ].sort((a, b) => b.score - a.score);

  function renderPatrol() {
    if (!patrol) return null;
    const tone = patrol.urgency === "danger" ? "danger" as const : patrol.urgency === "warn" ? "warn" as const : undefined;
    // 관리자별 편차(최근 4주) — 예전엔 "최근 흐름(참고용)" 트렌드 스트립에 따로 떨어져 있었다.
    // "마지막 순찰 이후"와 "오늘 몇 회"는 붙어야 뜻이 되고, 편차도 결국 같은 질문("순찰이 잘
    // 돌고 있나")이라 같은 카드 안에 둔다(집주인 지시). 관리자가 한 명뿐이면 편차랄 게 없으니
    // 표는 생략한다.
    const showPeople = patrolPeople !== null && patrolPeople.length > 1;
    return (
      <Card key="patrol" tone={tone}>
        <CardHead tone={tone} title="순찰 상태" icon={<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", color: tone ? `var(--${tone === "danger" ? "danger-strong" : "warn"})` : "var(--ink)" }}>
            {patrol.pace.lastLabel ?? "오늘 기록 없음"}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--sub)" }}>마지막 순찰 이후</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--sub)" }}>오늘 순찰 {patrol.pace.todayCount}회</div>
        {patrol.openSession && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--accent)" }}>
            {patrol.openSession.startedByName}님이 {patrol.openSession.timeLabel}부터 진행중 · {patrol.openSession.markedCount}명 표시
          </div>
        )}
        {showPeople && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 700, marginBottom: 1 }}>관리자별 순찰(최근 4주)</div>
            {patrolPeople!.map((p) => {
              const max = patrolPeople![0].n || 1;
              return (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 56, flex: "none" }}>{p.name}</span>
                  <div style={{ flex: 1, height: 6, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${(p.n / max) * 100}%`, height: "100%", background: "var(--accent)" }} />
                  </div>
                  <span style={{ width: 34, textAlign: "right", color: "var(--sub)" }}>{p.n}회</span>
                </div>
              );
            })}
          </div>
        )}
        <Link href="/m/patrol" style={{ display: "inline-block", marginTop: 10, fontSize: 12.5, color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>순찰 화면 열기 →</Link>
      </Card>
    );
  }

  function renderFlagged() {
    if (!patrol) return null;
    const { flagged, topPenaltyToday } = patrol;
    return (
      <Card key="flagged" tone={flagged.length > 0 ? "danger" : undefined}>
        <CardHead tone={flagged.length > 0 ? "danger" : undefined} title="주의해야 할 학생" icon={<><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></>} />
        {flagged.length === 0 ? (
          <Empty>지금 수면·딴짓으로 잡힌 학생이 없습니다.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {flagged.map((f) => {
              const preset = PATROL_BY_KEY[f.state];
              return (
                <div key={f.studentId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: solid(f.state === "sleep" ? "sleep" : "distract"), flex: "none" }} />
                  <span style={{ fontWeight: 600, width: 72, flex: "none" }}>{f.name}</span>
                  <span style={{ color: "var(--sub)", flex: "none" }}>{preset?.label ?? f.state}</span>
                  <span style={{ color: "var(--faint)", flex: "none" }}>{f.floor != null ? `${f.floor}층` : ""}{f.seatNumber != null ? ` ${f.seatNumber}번` : ""}</span>
                  <span style={{ marginLeft: "auto", color: "var(--sub)" }}>{f.atLabel} · {f.minutesAgo}분째</span>
                </div>
              );
            })}
          </div>
        )}
        {topPenaltyToday.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 700 }}>오늘 벌점 상위</div>
            {topPenaltyToday.map((p) => (
              <div key={p.studentId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span>{p.name}</span><span style={{ color: "var(--sub)" }}>{p.points}점</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  function renderOccupancy() {
    if (!seats) return null;
    return (
      <Card key="occ">
        <CardHead title="재실 현황" icon={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{seats.occupiedNow}</span>
          <span style={{ fontSize: 12.5, color: "var(--sub)" }}>/ {seats.total}석 사용중</span>
        </div>
        {seats.byFloor.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {seats.byFloor.map((f) => (
              <div key={f.floor} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 36, flex: "none", color: "var(--sub)" }}>{f.floor}층</span>
                <div style={{ flex: 1, height: 8, background: "var(--panel2)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${f.total > 0 ? (f.occupied / f.total) * 100 : 0}%`, height: "100%", background: "var(--accent)" }} />
                </div>
                <span style={{ width: 46, textAlign: "right", color: "var(--sub)" }}>{f.occupied}/{f.total}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "var(--sub)" }}>오늘 등원 후 퇴실 {seats.arrivedThenLeft}명</div>
        {seats.noShow.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11.5, color: "var(--faint)", fontWeight: 700, marginBottom: 4 }}>등원 예정 시각이 지났는데 기록이 없는 학생 {seats.noShow.length}명</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {seats.noShow.slice(0, 6).map((n) => (
                <div key={n.studentId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span>{n.name}</span><span style={{ color: "var(--warn)" }}>{n.arriveLabel} 예정 · {n.minutesLate}분 지남</span>
                </div>
              ))}
              {seats.noShow.length > 6 && <div style={{ fontSize: 11.5, color: "var(--faint)" }}>외 {seats.noShow.length - 6}명</div>}
            </div>
          </div>
        )}
      </Card>
    );
  }

  function renderTasks() {
    return (
      <Card key="tasks">
        <CardHead title="오늘 남은 일" icon={<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>} />
        {tasks.length === 0 ? (
          <Empty>대기중인 항목이 없습니다.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((t) => (
              <Link key={t.key} href={t.href} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, textDecoration: "none", color: "var(--txt)" }}>
                <span>{t.label}</span><span style={{ color: "var(--warn)", fontWeight: 700 }}>{t.n}건</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // 순찰 상태는 "오늘 남은 일"과 나란히 붙인다(집주인 지시) — 우선도 점수로 흩어지지 않게 상단에
  // 고정한 한 쌍이다. patrol.view 가 없으면 짝이 없으니 "오늘 남은 일" 혼자 한 줄을 그대로 쓴다.
  const topPair = patrol ? [renderPatrol(), renderTasks()] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11.5, color: "var(--faint)", textAlign: "center" }}>
        마지막 갱신 {snap.fetchedAtLabel}{secsAgo != null ? ` · ${secsAgo}초 전` : ""}
      </div>
      {topPair ? <div className="now-grid">{topPair}</div> : renderTasks()}
      {restSections.length > 0 && (
        <div className="now-grid">
          {restSections.map((s) => s.node)}
        </div>
      )}
    </div>
  );
}
