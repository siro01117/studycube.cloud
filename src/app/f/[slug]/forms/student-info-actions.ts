"use server";

// 학생 "내 정보" 조회 화면(내 시간표/내 출결/내 벌점, myts7fq2·myat4wkd·mypt9rxb) 공용 서버 액션.
// 전부 읽기 전용 — 쓰기 동작이 전혀 없다(f/actions.ts 의 submitForm 을 거치지 않는다).
// 본인확인은 다른 공개 폼과 같은 원칙: 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시
// 찾는다(schedule-request-actions.ts verifyIdentity 와 동일 패턴 — 파일마다 로컬로 두는 기존 관례를 따름).
// DEV-ONLY 테스트 신원(허브 "테스트로 건너뛰기")은 실제 student 행이 없어 모든 조회가 빈 결과 +
// testBypass:true 를 돌려준다 — 화면은 이 플래그로 "데이터 없음" 안내를 보여줘야 한다(빈 화면 금지).
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { getMySchedule, type MyHoursRow, type MyRuleRow } from "./schedule-request-actions";
import { PATROL_BY_KEY } from "@/lib/patrol";
import { PENALTY_BY_KEY } from "@/lib/penalty";
import { solid, tint } from "@/lib/semantic-color";
import { todayKey, addDays, weekdayOf, weekStartKey, timeLabel, minuteOfKST } from "@/lib/date";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

type IdentityResult =
  | { ok: true; studentId: string; studentName: string; testBypass: false }
  | { ok: true; studentId: null; studentName: string; testBypass: true }
  | { ok: false; error: string; kind?: "identity" };

/** DEV-ONLY 테스트 신원은 실제 student 행이 없어 student_id not null 인 테이블(attendance_event 등)에
 * 쓸 수 없는 것과 마찬가지로 조회도 불가 — testBypass:true 로만 알려주고 studentId 는 null 로 둔다. */
async function verifyIdentity(formData: FormData): Promise<IdentityResult> {
  const name = s(formData.get("name"));
  const code = s(formData.get("code"));
  if (process.env.NODE_ENV !== "production" && s(formData.get("test")) === "1") {
    return { ok: true, studentId: null, studentName: name || "테스트", testBypass: true };
  }
  const match = await findStudent(name, code);
  if (!match.ok) return { ok: false, error: publicAuthError(match.reason), kind: "identity" };
  return { ok: true, studentId: match.id, studentName: match.name, testBypass: false };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function fmtRange(start: number, end: number): string {
  const endLabel = end >= 1440 ? `다음날 ${fmtClock(end)}` : fmtClock(end);
  return `${fmtClock(start)}–${endLabel}`;
}
const WD_KR = ["일", "월", "화", "수", "목", "금", "토"];
function dateLabelOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 (${WD_KR[weekdayOf(date)]})`;
}
/** 좁은 화면 추이 그래프용 짧은 라벨("8/25", 요일 없음) — 폰 폭에서 6개를 나란히 놓아야 해서. */
function shortDateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}
/** DB 요일값(1=월..7=일, schedule_hours/schedule_rule 저장 규약) ← date.ts weekdayOf(0=일..6=토) 변환.
 * src/app/m/student/[id]/util.ts 의 dbDayOf 와 같은 계산이지만, 관리 화면 파일을 import 하지 않기 위해
 * (재사용은 lib 수준에서만) 여기 새로 작게 둔다. */
function dbDayOf(dateKey: string): number {
  const wd = weekdayOf(dateKey);
  return wd === 0 ? 7 : wd;
}

// ================= 1) 내 시간표 =================
export type MyExceptionRow = {
  id: string;
  date: string;
  dateLabel: string;
  wd: number; // 1=월..7=일
  reason: string;
  title: string | null;
  timeLabel: string;
};
export type ScheduleSubmissionStatus = "pending" | "done" | "rejected" | null;
export type MyScheduleOverviewResult =
  | {
      ok: true;
      testBypass: boolean;
      hours: MyHoursRow[];
      rules: MyRuleRow[];
      exceptions: MyExceptionRow[];
      submissionStatus: ScheduleSubmissionStatus;
      submissionNote: string | null;
    }
  | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test. hours/rules 는 이미 있는 getMySchedule 을 그대로
 * 재사용(재구현하지 않음) — 여기서는 그 위에 승인된 임시 일정(schedule_exception, 이번 주+다음 주)과
 * 스케쥴 제출 처리 상태(submission.status)만 추가로 조회한다. */
export async function getMyScheduleOverview(formData: FormData): Promise<MyScheduleOverviewResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    return { ok: true, testBypass: true, hours: [], rules: [], exceptions: [], submissionStatus: null, submissionNote: null };
  }

  const mine = await getMySchedule(formData);
  if (!mine.ok) return mine;

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const today = todayKey();
  const weekStart = weekStartKey(new Date(`${today}T12:00:00Z`));
  const rangeEnd = addDays(weekStart, 13); // 이번 주(월~일) + 다음 주(월~일)

  const [exRes, subRes] = await Promise.all([
    db.query<{ id: string; date: string; reason: string; title: string | null; start_min: number; end_min: number }>(
      `select id, date::text as date, reason, title, start_min, end_min from schedule_exception
        where branch_id=$1 and student_id=$2 and date between $3 and $4
        order by date, start_min`,
      [branch, id.studentId, weekStart, rangeEnd],
    ),
    db.query<{ status: string; note: string | null }>(
      `select status, note from submission
        where branch_id=$1 and student_id=$2 and type='schedule'
        order by created_at desc limit 1`,
      [branch, id.studentId],
    ),
  ]);

  const exceptions: MyExceptionRow[] = exRes.rows.map((r) => ({
    id: r.id,
    date: r.date,
    dateLabel: dateLabelOf(r.date),
    wd: dbDayOf(r.date),
    reason: r.reason,
    title: r.title,
    timeLabel: fmtRange(r.start_min, r.end_min),
  }));
  const sub = subRes.rows[0] ?? null;

  return {
    ok: true,
    testBypass: false,
    hours: mine.hours,
    rules: mine.rules,
    exceptions,
    submissionStatus: sub ? (sub.status as ScheduleSubmissionStatus) : null,
    submissionNote: sub?.note ?? null,
  };
}

// ================= 2) 내 출결 =================
const ATT_RECENT_DAYS = 30;

export type AttendanceDayRow = {
  date: string;
  dateLabel: string;
  wd: string;
  firstIn: string | null; // "HH:MM"
  lastOut: string | null; // "HH:MM"
  totalLabel: string | null; // "H시간 M분"
  late: boolean;
};
export type AttendanceHeatCell = {
  date: string;
  dayNum: number;
  isToday: boolean;
  hasData: boolean;
  color: string | null;
  dot: string | null; // 지각 표시
  title: string | null;
};
export type AttendanceOverviewResult =
  | {
      ok: true;
      testBypass: boolean;
      leading: number; // 히트맵 첫 주 앞쪽 빈 칸 수(월요일=0)
      heat: AttendanceHeatCell[]; // 30일, 오래된 → 오늘 순
      recent: AttendanceDayRow[]; // 최근 10일, 최근 → 과거 순
    }
  | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test. 관리 화면(m/student/[id]/util.ts)의 30일 히트맵·목록과
 * 같은 발상이지만 학생 화면은 훨씬 단순하게 새로 구현한다(그 파일은 순찰·벌점·신뢰도 배지까지 포함한
 * 관리자 전용 집계라 그대로 가져다 쓰기엔 과함 — m/** 은 수정하지 않고, 필요한 부분만 여기서 새로 짠다).
 * attendance_event.date 는 기록 시점에 이미 KST 달력 날짜로 찍혀 있어(attendanceActions.ts 등) 그
 * 컬럼으로 바로 묶는다(관리 화면의 06시 세션일 재계산은 여기선 생략 — "단순하게"). */
export async function getMyAttendanceOverview(formData: FormData): Promise<AttendanceOverviewResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    return { ok: true, testBypass: true, leading: 0, heat: [], recent: [] };
  }

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const today = todayKey();
  const start = addDays(today, -(ATT_RECENT_DAYS - 1));

  const [evRes, hrsRes] = await Promise.all([
    db.query<{ date: string; at: string; kind: string }>(
      `select date::text as date, at, kind from attendance_event
        where branch_id=$1 and student_id=$2 and date between $3 and $4
        order by date, at`,
      [branch, id.studentId, start, today],
    ),
    db.query<{ day: number; arrive_min: number }>(
      `select day, arrive_min from schedule_hours where branch_id=$1 and student_id=$2`,
      [branch, id.studentId],
    ),
  ]);

  const byDate = new Map<string, { at: string; kind: string }[]>();
  for (const r of evRes.rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const arriveByDay = new Map<number, number>(hrsRes.rows.map((r) => [r.day, r.arrive_min]));

  const days: (AttendanceDayRow & { totalMin: number | null; hasIn: boolean })[] = [];
  for (let i = ATT_RECENT_DAYS - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const events = byDate.get(date) ?? [];
    const firstInRow = events.find((e) => e.kind === "in") ?? null;
    let lastOutRow: { at: string; kind: string } | null = null;
    for (let j = events.length - 1; j >= 0; j--) {
      if (events[j].kind === "out") {
        lastOutRow = events[j];
        break;
      }
    }
    const firstIn = firstInRow ? timeLabel(firstInRow.at) : null;
    const lastOut = lastOutRow ? timeLabel(lastOutRow.at) : null;
    let totalMin: number | null = null;
    let totalLabel: string | null = null;
    if (firstInRow && lastOutRow) {
      const a = minuteOfKST(firstInRow.at);
      const b0 = minuteOfKST(lastOutRow.at);
      const b = b0 <= a ? b0 + 1440 : b0;
      totalMin = b - a;
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      totalLabel = h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
    }
    const arriveMin = arriveByDay.get(dbDayOf(date)) ?? null;
    const late = !!(firstInRow && arriveMin != null && minuteOfKST(firstInRow.at) > arriveMin);
    days.push({
      date,
      dateLabel: dateLabelOf(date),
      wd: WD_KR[weekdayOf(date)],
      firstIn,
      lastOut,
      totalLabel,
      totalMin,
      hasIn: !!firstInRow,
      late,
    });
  }

  const leading = dbDayOf(days[0].date) - 1;
  const heat: AttendanceHeatCell[] = days.map((d) => {
    const dayNum = Number(d.date.slice(8, 10));
    const hasData = d.hasIn;
    let pct = 0;
    if (d.totalMin != null) {
      pct = d.totalMin < 3 * 60 ? 18 : d.totalMin < 6 * 60 ? 38 : d.totalMin < 9 * 60 ? 62 : 88;
    } else if (hasData) {
      pct = 14; // 입실은 했지만 퇴실 미기록(재실 중이거나 기록 누락)
    }
    const outLabel = d.lastOut ? `퇴실 ${d.lastOut}` : "퇴실 미기록";
    return {
      date: d.date,
      dayNum,
      isToday: d.date === today,
      hasData,
      color: hasData ? tint("present", pct) : null,
      dot: d.late ? solid("late") : null,
      title: hasData ? `${d.dateLabel} · 입실 ${d.firstIn}${d.totalLabel ? ` · 재실 ${d.totalLabel}` : ` · ${outLabel}`}` : null,
    };
  });

  const recent: AttendanceDayRow[] = days
    .slice(-10)
    .reverse()
    .map((d) => ({ date: d.date, dateLabel: d.dateLabel, wd: d.wd, firstIn: d.firstIn, lastOut: d.lastOut, totalLabel: d.totalLabel, late: d.late }));

  return { ok: true, testBypass: false, leading, heat, recent };
}

// ================= 3) 내 벌점 =================
export type PenaltyReasonBar = { label: string; count: number; points: number; pct: number };
// src: 순찰 중 자동 기록됐는지("patrol") 카운터가 직접 부여했는지("manual") — 관리 화면(m/penalty)은
// 이미 이 둘을 구분해 보여준다(DetailRow.source). 학생 화면도 "누가 줬는지" 알 수 있게 같이 내려준다.
export type PenaltyRecentItem = { date: string; dateLabel: string; time: string; label: string; points: number; dot: string; src: "patrol" | "manual" };
export type PenaltyTrendWeek = { weekStart: string; weekLabel: string; points: number; isCurrent: boolean };
export type PenaltyOverviewResult =
  | {
      ok: true;
      testBypass: boolean;
      thisWeekPoints: number;
      /** 이번 주 집계 기간 — "몇 점"뿐 아니라 "언제부터 언제까지"를 화면에 명시하기 위함(월요일 0시 리셋). */
      weekStartLabel: string;
      weekEndLabel: string;
      last30ViolationCount: number;
      reasonBars: PenaltyReasonBar[];
      recent: PenaltyRecentItem[];
      /** 최근 6주 추이(관리 화면 getStudentPenaltyTrend 와 같은 방식 — 주 단위 합계, 오래된→최근 순).
       *  m/penalty/actions.ts 는 admin guard 를 거는 관리자 전용 파일이라 그대로 import 할 수 없어
       *  같은 로직을 이 파일(학생 신원 검증 경로)에 맞춰 다시 작게 둔다. */
      weeklyTrend: PenaltyTrendWeek[];
    }
  | { ok: false; error: string; kind?: "identity" };

const PENALTY_TREND_WEEKS = 6;

/** FormData: slug, name, code, (개발전용) test. 판정 기준은 관리 화면(m/student/[id]/util.ts
 * isPatrolViolation)과 동일: 위반 = 점수가 0보다 큰 이벤트(입석·학원·원내 수업·주간 상담은 프리셋 자체가
 * points=0 이라 자동으로 빠진다). 순찰(patrol_event)·수동 벌점(penalty_event) 둘 다 points>0 만 세고,
 * union all 로 한 번에 조회해 이벤트 축을 합친다. 6주 추이는 범위가 달라(월요일 정렬 42일) 쿼리 하나를
 * 더 쓴다 — 학생 1명 기준이라 N+1 이 아니라 이 화면당 고정 2쿼리. */
export async function getMyPenaltyOverview(formData: FormData): Promise<PenaltyOverviewResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    const today = todayKey();
    const weekStart = weekStartKey(new Date(`${today}T12:00:00Z`));
    return {
      ok: true, testBypass: true, thisWeekPoints: 0,
      weekStartLabel: dateLabelOf(weekStart), weekEndLabel: dateLabelOf(addDays(weekStart, 6)),
      last30ViolationCount: 0, reasonBars: [], recent: [], weeklyTrend: [],
    };
  }

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const today = todayKey();
  const start = addDays(today, -29);
  const weekStart = weekStartKey(new Date(`${today}T12:00:00Z`));

  // 6주 추이 범위(월요일 정렬) — 지난 5주 시작 ~ 이번 주 시작 + 7일(배타적 상한). 30일 범위와 겹치므로
  // 한 번에 넉넉히 뽑아 자바스크립트에서 두 용도(최근 30일 집계 / 6주 버킷)로 나눠 쓴다.
  const trendWeeks = Array.from({ length: PENALTY_TREND_WEEKS }, (_, i) => addDays(weekStart, -7 * (PENALTY_TREND_WEEKS - 1 - i)));
  const rangeStart = trendWeeks[0] < start ? trendWeeks[0] : start;
  const rangeEnd = addDays(weekStart, 6); // 이번 주 일요일(포함 상한 — start 는 오늘까지지만 이번 주는 끝까지 커버)

  const rows = await db.query<{ date: string; at: string; points: number; key: string; src: string }>(
    `select date::text as date, at, points, state as key, 'patrol' as src
       from patrol_event
      where branch_id=$1 and student_id=$2 and date between $3 and $4 and points > 0
     union all
     select date::text as date, at, points, reason as key, 'manual' as src
       from penalty_event
      where branch_id=$1 and student_id=$2 and date between $3 and $4 and points > 0
      order by at desc`,
    [branch, id.studentId, rangeStart, rangeEnd],
  );

  const labelOf = (key: string, src: string) => (src === "patrol" ? (PATROL_BY_KEY[key]?.label ?? key) : (PENALTY_BY_KEY[key]?.label ?? key));
  const dotOf = (key: string, src: string) => (src === "patrol" ? (PATROL_BY_KEY[key]?.dot ?? solid("distract")) : solid("distract"));

  let thisWeekPoints = 0;
  let last30ViolationCount = 0;
  const reasonAgg = new Map<string, { count: number; points: number }>();
  const trendTotals = new Array(PENALTY_TREND_WEEKS).fill(0);
  const trendBucketOf = (date: string): number => {
    const [y1, m1, d1] = trendWeeks[0].split("-").map(Number);
    const [y2, m2, d2] = date.split("-").map(Number);
    return Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000 / 7);
  };
  for (const r of rows.rows) {
    if (r.date >= weekStart) thisWeekPoints += r.points;
    if (r.date >= start) {
      last30ViolationCount += 1;
      const label = labelOf(r.key, r.src);
      const cur = reasonAgg.get(label) ?? { count: 0, points: 0 };
      cur.count += 1;
      cur.points += r.points;
      reasonAgg.set(label, cur);
    }
    const b = trendBucketOf(r.date);
    if (b >= 0 && b < PENALTY_TREND_WEEKS) trendTotals[b] += r.points;
  }
  const maxCount = Math.max(1, ...[...reasonAgg.values()].map((v) => v.count));
  const reasonBars: PenaltyReasonBar[] = [...reasonAgg.entries()]
    .map(([label, v]) => ({ label, count: v.count, points: v.points, pct: Math.round((v.count / maxCount) * 100) }))
    .sort((a, b) => b.count - a.count);

  const recent: PenaltyRecentItem[] = rows.rows
    .filter((r) => r.date >= start)
    .slice(0, 10)
    .map((r) => ({
      date: r.date,
      dateLabel: dateLabelOf(r.date),
      time: timeLabel(r.at),
      label: labelOf(r.key, r.src),
      points: r.points,
      dot: dotOf(r.key, r.src),
      src: r.src as "patrol" | "manual",
    }));

  const weeklyTrend: PenaltyTrendWeek[] = trendWeeks.map((w, i) => ({
    weekStart: w,
    weekLabel: shortDateLabel(w),
    points: trendTotals[i],
    isCurrent: w === weekStart,
  }));

  return {
    ok: true, testBypass: false, thisWeekPoints,
    weekStartLabel: dateLabelOf(weekStart), weekEndLabel: dateLabelOf(addDays(weekStart, 6)),
    last30ViolationCount, reasonBars, recent, weeklyTrend,
  };
}
