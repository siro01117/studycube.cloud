"use server";

// 벌점 서버 액션 — 전용 모듈(/m/penalty)이 없어지면서 이 파일 하나로 합쳐졌다. 세 곳에서 쓴다:
// 1) 좌석 배치도 학생 상세의 벌점 사이드 패널(PenaltySidePanel) — 학생 1명의 이번 주 조회·부여·삭제.
// 2) 순찰 기록 화면의 "벌점 현황" 탭(PenaltyOverview) — 지점 전체 집계 + 학생별 상세도 같은 패널 재사용.
// 3) 폰 전용 벌점 화면(/penalty, MobilePenalty) — 그대로 이 파일을 가져다 쓴다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard, can } from "@/lib/auth";
import { PENALTY_BY_KEY, weekStartKey, weekStartLabel } from "@/lib/penalty";
import { PATROL_BY_KEY } from "@/lib/patrol";
import { todayKey as todayStr, addDays } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// 요청된 주(week 파라미터)를 KST 기준 유효한 월요일로 정규화 + 미래 주는 이번 주로 클램프.
// 과거 조회 화면(주 이동)·학생 상세 추이가 모두 이 함수로 "조회할 주"를 통일한다.
function resolveWeek(week?: string | null): string {
  const currentWeek = weekStartKey();
  if (!week || !WEEK_RE.test(week)) return currentWeek;
  const normalized = weekStartKey(new Date(`${week}T00:00:00Z`));
  return normalized > currentWeek ? currentWeek : normalized;
}

// 벌점 관련 화면을 새로고침 없이 최신 상태로 — 데스크톱 집계(순찰 기록의 벌점 현황 탭)와 폰 화면.
// 좌석 배치도 사이드 패널은 클라이언트가 직접 다시 조회하므로 경로 재검증이 필요 없다.
function revalidatePenaltyViews() {
  revalidatePath("/m/patrol");
  revalidatePath("/penalty");
}

// 수동 벌점 부여 (프리셋 사유). points 는 프리셋에서 스냅샷 → 나중 프리셋 바꿔도 과거 불변.
// date: 선택 요일(이번 주 범위·미래 아님으로 클램프). 없으면 오늘.
export async function givePenalty(formData: FormData) {
  const me = await guard("penalty.manage");
  const id = s(formData.get("studentId"));
  const reason = s(formData.get("reason"));
  const note = s(formData.get("note"));
  if (!id || !reason) return;
  const preset = PENALTY_BY_KEY[reason];
  if (!preset) return;
  const today = todayStr();
  const ws = weekStartKey(new Date());
  const wanted = s(formData.get("date"));
  const date = wanted && wanted >= ws && wanted <= today ? wanted : today; // 이번 주·오늘까지만
  await db.query(
    `insert into penalty_event(branch_id, student_id, reason, points, note, date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [me.activeBranchId, id, reason, preset.points, note, date, me.id],
  );
  revalidatePenaltyViews();
}

// 수동 벌점 1건 삭제(정정)
export async function removePenalty(formData: FormData) {
  const me = await guard("penalty.manage");
  const id = s(formData.get("id"));
  if (!id) return;
  await db.query(`delete from penalty_event where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePenaltyViews();
}

// removePenalty 로 지운 벌점 실행취소 — 클라가 삭제 직전에 들고 있던 원본 값(id·시각·부여자 포함)
// 그대로 재기록한다. id 를 그대로 재사용하므로 삭제 직후 취소 안 하면 그 id 는 그대로 사라진다.
export async function restorePenalty(formData: FormData) {
  const me = await guard("penalty.manage");
  const id = s(formData.get("id"));
  const studentId = s(formData.get("studentId"));
  const reason = s(formData.get("reason"));
  const note = s(formData.get("note"));
  const at = s(formData.get("at"));
  const date = s(formData.get("date"));
  const createdBy = s(formData.get("createdBy"));
  const points = Number(formData.get("points"));
  if (!id || !studentId || !reason || !at || !date || !Number.isFinite(points)) return;
  await db.query(
    `insert into penalty_event(id, branch_id, student_id, reason, points, note, at, date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, me.activeBranchId, studentId, reason, points, note, at, date, createdBy],
  );
  revalidatePenaltyViews();
}

// 한 학생의 특정 주 벌점 내역 (순찰 + 수동 합쳐 시간순). 순찰 것은 삭제 불가(순찰 기록에서 정정).
// weekStart 생략(또는 미래/형식 오류) 시 이번 주로 클램프 — 과거 주 조회와 학생 상세가 같은 규칙
// (resolveWeek)으로 "조회할 주"를 맞춘다.
export async function getStudentPenaltyWeek(studentId: string, weekStart?: string) {
  const me = await guard("penalty.view");
  const ws = resolveWeek(weekStart);
  const weekEnd = addDays(ws, 7); // 다음 주 월요일(배타적 상한) — 과거 주 조회 시 그 다음 주 기록이 섞이지 않게
  const [pat, man] = await Promise.all([
    db.query<{ id: string; state: string; points: number; at: string; date: string; session_id: string | null; seat_id: string | null; created_by: string | null }>(
      `select id, state, points, at::text as at, date::text as date, session_id, seat_id, created_by from patrol_event
        where student_id=$1 and branch_id=$2 and date >= $3 and date < $4 and points <> 0 order by at`,
      [studentId, me.activeBranchId, ws, weekEnd],
    ),
    db.query<{ id: string; reason: string; points: number; note: string | null; at: string; date: string; created_by: string | null }>(
      `select id, reason, points, note, at::text as at, date::text as date, created_by from penalty_event
        where student_id=$1 and branch_id=$2 and date >= $3 and date < $4 order by at`,
      [studentId, me.activeBranchId, ws, weekEnd],
    ),
  ]);
  // reason/state 는 실행취소(복원) 시 그대로 다시 넣기 위한 원시 키 — 화면 표시용 label 과 별개로 내려준다.
  const rows = [
    ...pat.rows.map((r) => ({ source: "patrol" as const, id: r.id, label: `순찰 · ${PATROL_BY_KEY[r.state]?.label ?? r.state}`, points: r.points, note: null as string | null, at: r.at, date: r.date, state: r.state, sessionId: r.session_id, seatId: r.seat_id, createdBy: r.created_by })),
    ...man.rows.map((r) => ({ source: "manual" as const, id: r.id, label: PENALTY_BY_KEY[r.reason]?.label ?? r.reason, points: r.points, note: r.note, at: r.at, date: r.date, reason: r.reason, createdBy: r.created_by })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  return rows;
}

// 학생 상세 모달의 "최근 몇 주 추이" — 상습 여부 판단용. 6주(약 1개월 반): 매주 반복되는 패턴을
// 알아보기엔 충분하고, 440px 폭 패널에 막대 6개가 부담 없이 들어가는 선.
// weekStart(조회 중인 주)로 끝나는 6주를 오래된→최신 순으로 반환.
const TREND_WEEKS = 6;
export type PenaltyTrendWeek = { weekStart: string; points: number };
export async function getStudentPenaltyTrend(studentId: string, weekStart?: string): Promise<PenaltyTrendWeek[]> {
  const me = await guard("penalty.view");
  const ws = resolveWeek(weekStart);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(ws, -7 * (TREND_WEEKS - 1 - i)));
  const rangeStart = weeks[0];
  const rangeEnd = addDays(ws, 7); // 배타적 상한
  const [pat, man] = await Promise.all([
    db.query<{ date: string; points: number }>(
      `select date::text as date, points from patrol_event
        where student_id=$1 and branch_id=$2 and date >= $3 and date < $4 and points <> 0`,
      [studentId, me.activeBranchId, rangeStart, rangeEnd],
    ),
    db.query<{ date: string; points: number }>(
      `select date::text as date, points from penalty_event
        where student_id=$1 and branch_id=$2 and date >= $3 and date < $4`,
      [studentId, me.activeBranchId, rangeStart, rangeEnd],
    ),
  ]);
  // 날짜 문자열끼리 UTC 자정 기준 일수 차 → 7일 버킷 인덱스(주 경계는 addDays 와 동일한 날짜 문자열 산수).
  const bucketOf = (date: string): number => {
    const [y1, m1, d1] = rangeStart.split("-").map(Number);
    const [y2, m2, d2] = date.split("-").map(Number);
    return Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000 / 7);
  };
  const totals = new Array(TREND_WEEKS).fill(0);
  for (const r of [...pat.rows, ...man.rows]) {
    const b = bucketOf(r.date);
    if (b >= 0 && b < TREND_WEEKS) totals[b] += r.points;
  }
  return weeks.map((w, i) => ({ weekStart: w, points: totals[i] }));
}

// 지점 전체 집계 — 순찰 기록 화면 "벌점 현황" 탭(PenaltyOverview) 전용. 예전 /m/penalty 페이지가
// 서버 컴포넌트에서 하던 걸 그대로 서버 액션으로 옮겨 클라에서 주 이동마다 다시 불러온다(풀 페이지
// 이동 없이). 재원생만 집계 → 목록·좌석뷰(재원생 기준)와 정확히 일치.
export type OverviewStudent = { id: string; name: string; level: string | null; grade: string | null; is_repeat: boolean | null; seat_number: number | null };
export type OverviewBreakdown = { label: string; points: number; count: number; sessions?: number };
export type PenaltyOverview = {
  students: OverviewStudent[];
  weekly: Record<string, number>;
  breakdown: OverviewBreakdown[];
  weekLabel: string;
  weekStart: string;
  isCurrentWeek: boolean;
  today: string;
  canManage: boolean;
  canPatrolManage: boolean;
};
export async function getPenaltyOverview(weekStart?: string): Promise<PenaltyOverview> {
  const me = await guard("penalty.view");
  const branch = me.activeBranchId;
  const ws = resolveWeek(weekStart);
  const currentWeek = weekStartKey();
  const isCurrentWeek = ws === currentWeek;
  const weekEnd = addDays(ws, 7); // 다음 주 월요일(배타적 상한)

  const [students, patRows, manRows, patrolSessions] = await Promise.all([
    db.query<OverviewStudent>(
      `select s.id, s.name, s.level, s.grade, s.is_repeat, seat.number as seat_number
         from student s left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
        where s.branch_id=$1 and s.status='enrolled' order by s.name`,
      [branch],
    ),
    db.query<{ student_id: string; state: string; pts: number; cnt: number }>(
      `select pe.student_id, pe.state, sum(pe.points)::int as pts, count(*)::int as cnt from patrol_event pe
         join student s on s.id=pe.student_id and s.status='enrolled'
        where pe.branch_id=$1 and pe.date>=$2 and pe.date<$3 and pe.points<>0 group by pe.student_id, pe.state`,
      [branch, ws, weekEnd],
    ),
    db.query<{ student_id: string; reason: string; pts: number; cnt: number }>(
      `select pn.student_id, pn.reason, sum(pn.points)::int as pts, count(*)::int as cnt from penalty_event pn
         join student s on s.id=pn.student_id and s.status='enrolled'
        where pn.branch_id=$1 and pn.date>=$2 and pn.date<$3 group by pn.student_id, pn.reason`,
      [branch, ws, weekEnd],
    ),
    // 이 주 안에 지점이 실제로 돌린 순찰 세션 수(학생별 아님) — 순찰 기인 점수 옆에 분모로 보여줘
    // "직원마다 순찰 횟수가 달라 같은 행동이 다른 점수가 된다"는 편차가 해석을 왜곡하지 않게 한다.
    db.query<{ n: number }>(`select count(*)::int as n from patrol_session where branch_id=$1 and date>=$2 and date<$3`, [branch, ws, weekEnd]),
  ]);
  const sessionCount = patrolSessions.rows[0]?.n ?? 0;

  const weekly: Record<string, number> = {};
  const patByState = new Map<string, { pts: number; cnt: number }>();
  for (const r of patRows.rows) {
    weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;
    const c = patByState.get(r.state) ?? { pts: 0, cnt: 0 };
    c.pts += r.pts; c.cnt += r.cnt; patByState.set(r.state, c);
  }
  const manByReason = new Map<string, { pts: number; cnt: number }>();
  for (const r of manRows.rows) {
    weekly[r.student_id] = (weekly[r.student_id] ?? 0) + r.pts;
    const c = manByReason.get(r.reason) ?? { pts: 0, cnt: 0 };
    c.pts += r.pts; c.cnt += r.cnt; manByReason.set(r.reason, c);
  }

  const breakdown: OverviewBreakdown[] = [
    ...[...patByState].map(([state, v]) => ({ label: `순찰 · ${PATROL_BY_KEY[state]?.label ?? state}`, points: v.pts, count: v.cnt, sessions: sessionCount })),
    ...[...manByReason].map(([reason, v]) => ({ label: PENALTY_BY_KEY[reason]?.label ?? reason, points: v.pts, count: v.cnt })),
  ].filter((b) => b.points > 0).sort((a, b) => b.points - a.points);

  return {
    students: students.rows,
    weekly,
    breakdown,
    weekLabel: weekStartLabel(ws),
    weekStart: ws,
    isCurrentWeek,
    today: todayStr(),
    canManage: can(me, "penalty.manage"),
    canPatrolManage: can(me, "patrol.manage"),
  };
}
