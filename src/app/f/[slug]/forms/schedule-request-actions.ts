"use server";

// 일정 변경 신청(exr8k3mq.tsx) 전용 서버 액션. 저장은 submission 이 아니라 schedule_request 에
// 직접(f/actions.ts 의 submitForm 을 거치지 않는다) — 입력 기간(schedule_window/schedule_grant)과
// 무관하게 언제나 접수한다(수정이 아니라 신청이라서).
// 본인확인은 다른 공개 폼과 같은 원칙 — 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시 찾는다.
//
// 신청 갈래(reqKind, src/lib/schedule.ts REQUEST_KINDS 가 단일 출처) 3가지:
// - temp: 특정 날짜 하루만 바뀜(기존 로직, 5유형 absent/late/early/out/custom).
// - rule_edit: 기존 정기 규칙(schedule_rule) 하나의 요일/시간/사유/제목을 바꾸는 신청.
// - rule_delete: 기존 정기 규칙 하나를 영구 삭제하는 신청.
// 실제 승인(schedule_rule 갱신·삭제, schedule_exception 생성)은 src/lib/schedule-request.ts 가
// 관리자 승인 경로와 공유한다 — 여기서는 신청 생성(검증·insert)만 담당.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import {
  SCHEDULE_REASONS, type ScheduleKind,
  REQUEST_TYPES, type RequestType, type RequestTypeRawInput, resolveRequestRange, requestTimeLabel,
  type RequestKind, daysLabelOf, daysCsvOf,
} from "@/lib/schedule";
import { todayKey, addDays, weekdayOf } from "@/lib/date";
import { approveScheduleRequest, isAutoApproveOn } from "@/lib/schedule-request";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const MAX_ITEMS = 10;
const MAX_AHEAD_DAYS = 14;
const REQ_TYPE_KEYS = new Set<string>(REQUEST_TYPES.map((t) => t.key));
const isRawMin = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1439;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WD_KR = ["일", "월", "화", "수", "목", "금", "토"];

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

/** 날짜 선택 범위(오늘~14일 이내) — 클라이언트가 날짜 입력의 min/max 를 이걸로만 정한다.
 * 클라 렌더에서 new Date() 를 직접 부르지 않는 원칙(서버에서 KST 로 미리 계산해 내려줌). */
export async function getDateBounds(): Promise<{ today: string; maxDate: string }> {
  const today = todayKey();
  return { today, maxDate: addDays(today, MAX_AHEAD_DAYS) };
}

/** "YYYY-MM-DD" → 1(월)..7(일). weekdayOf 는 0(일)..6(토)를 주므로 변환. */
function dow1to7(date: string): number {
  return ((weekdayOf(date) + 6) % 7) + 1;
}
function dateLabelOf(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 (${WD_KR[weekdayOf(date)]})`;
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

type IdentityResult =
  | { ok: true; studentId: string; studentName: string; testBypass: false }
  | { ok: true; studentId: null; studentName: string; testBypass: true }
  | { ok: false; error: string; kind?: "identity" };

/** DEV-ONLY 테스트 신원(허브 "테스트로 건너뛰기") 은 실제 student 행이 없어 student_id not null 인
 * schedule_request 에 쓸 수 없다 — 그래서 이 폼에서는 테스트 신원을 "신원 확인은 통과, 실제 신청은
 * 불가"로만 다룬다(f/actions.ts submitForm 처럼 studentId=null 로 저장하지 않는다). */
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

// ---------------- 그 날짜의 정기 일정(겹침 확인용) + 정기 등·하원 시각(유형 환산 기준) ----------------
export type DayRuleRow = { id: string; kind: ScheduleKind; reason: string; title: string; start: number; end: number };
export type DayHours = { arrive: number; leave: number };
export type GetDayRulesResult =
  | { ok: true; rules: DayRuleRow[]; hours: DayHours | null }
  | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, date, (개발전용) test. 그 날짜(요일)에 이미 걸려 있는 정기 규칙과
 * 정기 등·하원 시각(schedule_hours)을 함께 돌려준다 — 신청 폼이 "이 시간, 겹치는 정기 일정이 있어요"를
 * 보여주고 대체/추가를 고르게 하는 데, 그리고 absent/late/early 유형의 시간 환산 미리보기(최종 확정은
 * createRequests 가 서버에서 다시 계산)에 쓴다. */
export async function getDayRules(formData: FormData): Promise<GetDayRulesResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  const date = s(formData.get("date"));
  if (!DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
  if (id.testBypass || !id.studentId) return { ok: true, rules: [], hours: null };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const dow = dow1to7(date);
  const [r, h] = await Promise.all([
    db.query<{ id: string; kind: ScheduleKind; reason: string; title: string; start_min: number; end_min: number; days: string }>(
      `select id, kind, reason, title, start_min, end_min, days from schedule_rule where branch_id=$1 and student_id=$2`,
      [branch, id.studentId],
    ),
    db.query<{ arrive_min: number; leave_min: number }>(
      `select arrive_min, leave_min from schedule_hours where branch_id=$1 and student_id=$2 and day=$3`,
      [branch, id.studentId, dow],
    ),
  ]);
  const rules: DayRuleRow[] = r.rows
    .filter((row) => row.days.split(",").map(Number).includes(dow))
    .map((row) => ({ id: row.id, kind: row.kind, reason: row.reason, title: row.title, start: row.start_min, end: row.end_min }));
  const hours: DayHours | null = h.rows[0] ? { arrive: h.rows[0].arrive_min, leave: h.rows[0].leave_min } : null;
  return { ok: true, rules, hours };
}

// ---------------- 내 정기 스케쥴(읽기 전용) + 정기 일정 목록(수정·삭제 신청 대상 선택용) ----------------
// 쿼리 2개(schedule_hours, schedule_rule)만 써서 그 학생의 정기 스케쥴 전체를 내려준다. 문자열 포맷
// (시각·요일 라벨)은 전부 여기 서버에서 만들어 내려준다(클라 렌더에서 포맷 계산 금지 원칙).
export type MyHoursRow = { day: number; arrive: number; leave: number; arriveLabel: string; leaveLabel: string };
export type MyRuleRow = {
  id: string; kind: ScheduleKind; reason: string; title: string;
  start: number; end: number; days: number[]; daysLabel: string; timeLabel: string;
};
export type MyScheduleResult = { ok: true; hours: MyHoursRow[]; rules: MyRuleRow[] } | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test. */
export async function getMySchedule(formData: FormData): Promise<MyScheduleResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) return { ok: true, hours: [], rules: [] };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const [h, r] = await Promise.all([
    db.query<{ day: number; arrive_min: number; leave_min: number }>(
      `select day, arrive_min, leave_min from schedule_hours where branch_id=$1 and student_id=$2 order by day`,
      [branch, id.studentId],
    ),
    db.query<{ id: string; kind: ScheduleKind; reason: string; title: string; start_min: number; end_min: number; days: string }>(
      `select id, kind, reason, title, start_min, end_min, days from schedule_rule where branch_id=$1 and student_id=$2 order by start_min`,
      [branch, id.studentId],
    ),
  ]);

  const hours: MyHoursRow[] = h.rows.map((row) => ({
    day: row.day, arrive: row.arrive_min, leave: row.leave_min,
    arriveLabel: fmtClock(row.arrive_min), leaveLabel: row.leave_min >= 1440 ? `다음날 ${fmtClock(row.leave_min)}` : fmtClock(row.leave_min),
  }));
  const rules: MyRuleRow[] = r.rows.map((row) => ({
    id: row.id, kind: row.kind, reason: row.reason, title: row.title, start: row.start_min, end: row.end_min,
    days: row.days.split(",").map(Number).filter((n) => n >= 1 && n <= 7),
    daysLabel: daysLabelOf(row.days), timeLabel: fmtRange(row.start_min, row.end_min),
  }));
  return { ok: true, hours, rules };
}

// ---------------- 신청 생성 ----------------
export type TempItemInput = {
  reqKind: "temp";
  date: string;
  reasonKey: string;
  title: string;
  reqType: RequestType;
  raw: RequestTypeRawInput; // 클라가 만든 원값(0~1439 minute-of-day) — 최종 start/end 는 서버가 확정한다.
  mode: "add" | "replace";
  skipRuleId?: string | null;
};
export type RuleEditItemInput = {
  reqKind: "rule_edit";
  targetRuleId: string;
  reasonKey: string;
  title: string;
  days: number[]; // 1..7
  start: number; // 0~1439(raw) — 자정 넘김은 서버가 resolveRequestRange(custom)로 정규화
  end: number;
};
export type RuleDeleteItemInput = { reqKind: "rule_delete"; targetRuleId: string };
export type RequestItemInput = TempItemInput | RuleEditItemInput | RuleDeleteItemInput;

export type MyRequestRow = {
  id: string;
  reqKind: RequestKind;
  date: string | null;
  dateLabel: string | null; // rule_edit/rule_delete 는 특정 날짜가 없어 null
  kind: ScheduleKind;
  reason: string;
  title: string | null;
  reqType: RequestType; // temp 에서만 의미 있음
  daysLabel: string | null; // rule_edit(신청 요일)/rule_delete(삭제될 요일) — temp 는 null
  timeLabel: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
};
export type CreateRequestsResult = { ok: true; rows: MyRequestRow[] } | { ok: false; error: string; kind?: "identity" };

type RequestDbRow = {
  id: string; date: string | null; kind: ScheduleKind; reason: string; title: string | null; req_type: string;
  start_min: number; end_min: number; status: string; note: string | null; req_kind: string; days: string | null;
};
function toMyRow(row: RequestDbRow): MyRequestRow {
  const reqKind = (row.req_kind as RequestKind) ?? "temp";
  const daysLabel = row.days ? daysLabelOf(row.days) : null;
  const timeLabel = reqKind === "temp"
    ? requestTimeLabel(row.req_type, row.start_min, row.end_min)
    : `${daysLabel ? daysLabel + " " : ""}${fmtRange(row.start_min, row.end_min)}`;
  return {
    id: row.id, reqKind, date: row.date, dateLabel: row.date ? dateLabelOf(row.date) : null,
    kind: row.kind, reason: row.reason, title: row.title, reqType: row.req_type as RequestType,
    daysLabel, timeLabel, status: row.status as MyRequestRow["status"], note: row.note,
  };
}
const REQUEST_ROW_COLS = `id, date::text as date, kind, reason, title, req_type, start_min, end_min, status, note, req_kind, days`;

/** FormData: slug, name, code, (개발전용) test, items(JSON.stringify(RequestItemInput[])).
 * 한 배치 안의 모든 항목은 같은 reqKind 여야 한다(temp 는 여러 건, rule_edit/rule_delete 는 한 번에 한 건). */
export async function createRequests(formData: FormData): Promise<CreateRequestsResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    return { ok: false, error: "테스트 신원으로는 신청할 수 없어요. 실제 학생으로 접속해주세요." };
  }
  const studentId = id.studentId;

  let items: unknown;
  try {
    items = JSON.parse(s(formData.get("items")) || "[]");
  } catch {
    return { ok: false, error: "요청이 올바르지 않습니다." };
  }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "신청할 내용이 없습니다." };
  if (items.length > MAX_ITEMS) return { ok: false, error: `한 번에 최대 ${MAX_ITEMS}건까지 신청할 수 있어요.` };
  if (!items.every((it) => it && typeof it === "object")) return { ok: false, error: "신청 내용을 확인해주세요." };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const kinds = new Set((items as Record<string, unknown>[]).map((it) => (typeof it.reqKind === "string" ? it.reqKind : "")));
  if (kinds.size !== 1) return { ok: false, error: "한 번에 한 종류만 신청할 수 있어요." };
  const reqKind = [...kinds][0];

  if (reqKind === "rule_edit" || reqKind === "rule_delete") {
    if (items.length !== 1) return { ok: false, error: "정기 일정 수정·삭제는 한 번에 한 건만 신청할 수 있어요." };
    return createRuleChangeRequest(branch, studentId, reqKind, (items as Record<string, unknown>[])[0]);
  }
  if (reqKind !== "temp") return { ok: false, error: "신청 종류를 확인해주세요." };
  return createTempRequests(branch, studentId, items as Record<string, unknown>[]);
}

/** rule_edit/rule_delete — 정기 규칙(schedule_rule) 하나를 대상으로 한 신청 1건 생성. */
async function createRuleChangeRequest(
  branch: string, studentId: string, reqKind: "rule_edit" | "rule_delete", it0: Record<string, unknown>,
): Promise<CreateRequestsResult> {
  const targetRuleId = typeof it0.targetRuleId === "string" ? it0.targetRuleId : "";
  if (!UUID_RE.test(targetRuleId)) return { ok: false, error: "대상 정기 일정을 다시 선택해주세요." };

  const cur = await db.query<{ id: string; kind: ScheduleKind; reason: string; title: string; start_min: number; end_min: number; days: string }>(
    `select id, kind, reason, title, start_min, end_min, days from schedule_rule where id=$1 and branch_id=$2 and student_id=$3`,
    [targetRuleId, branch, studentId],
  );
  const rule = cur.rows[0];
  if (!rule) return { ok: false, error: "대상 정기 일정을 찾을 수 없어요. 다시 선택해주세요." };

  // 같은 정기 일정에 이미 대기 중인 신청이 있으면 막는다(수정·삭제 중복 신청 방지).
  const dup = await db.query(
    `select id from schedule_request where branch_id=$1 and student_id=$2 and target_rule_id=$3 and status='pending'`,
    [branch, studentId, targetRuleId],
  );
  if (dup.rows.length > 0) return { ok: false, error: "이 정기 일정에 대해 이미 처리 대기 중인 신청이 있어요." };

  let kind: ScheduleKind, reason: string, title: string, start: number, end: number, daysCsv: string;

  if (reqKind === "rule_edit") {
    const reasonOpt = SCHEDULE_REASONS.find((r) => r.key === it0.reasonKey);
    if (!reasonOpt) return { ok: false, error: "사유를 확인해주세요." };
    const daysRaw = Array.isArray(it0.days) ? (it0.days as unknown[]).filter((n): n is number => typeof n === "number") : [];
    daysCsv = daysCsvOf(daysRaw);
    if (!daysCsv) return { ok: false, error: "요일을 선택해주세요." };
    if (!isRawMin(it0.start) || !isRawMin(it0.end)) return { ok: false, error: "시간을 확인해주세요." };
    const resolved = resolveRequestRange({ type: "custom", start: it0.start, end: it0.end }, null);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    kind = reasonOpt.kind;
    reason = reasonOpt.label;
    title = typeof it0.title === "string" ? it0.title.trim().slice(0, 60) : "";
    start = resolved.start;
    end = resolved.end;
  } else {
    // rule_delete — 현재 값을 그대로 스냅샷(표시용)에 담는다. 실제 삭제는 승인 시점에 일어난다.
    kind = rule.kind; reason = rule.reason; title = rule.title; start = rule.start_min; end = rule.end_min; daysCsv = rule.days;
  }

  const inserted = await db.query<RequestDbRow>(
    `insert into schedule_request(branch_id, student_id, kind, reason, title, start_min, end_min, req_type, req_kind, target_rule_id, days)
     values ($1,$2,$3,$4,$5,$6,$7,'custom',$8,$9,$10)
     returning ${REQUEST_ROW_COLS}`,
    [branch, studentId, kind, reason, title || null, start, end, reqKind, targetRuleId, daysCsv],
  );
  const row0 = inserted.rows[0];
  if (!row0) return { ok: false, error: "신청에 실패했습니다." };

  if (await isAutoApproveOn(branch)) {
    await approveScheduleRequest(row0.id, branch, null);
    const refreshed = await db.query<RequestDbRow>(
      `select ${REQUEST_ROW_COLS} from schedule_request where id=$1`,
      [row0.id],
    );
    return { ok: true, rows: refreshed.rows.map(toMyRow) };
  }
  return { ok: true, rows: [toMyRow(row0)] };
}

/** temp — 서버 재검증: 날짜 범위(오늘~14일 이내), 분 값(0~1560), 한 번에 최대 10건, 같은 학생·같은 날짜·
 * 같은 시간대 중복 신청 거부. "대체"는 그 학생의 실제 정기 규칙(그 날짜 요일에 걸려 있는)만 허용한다. */
async function createTempRequests(branch: string, studentId: string, items: Record<string, unknown>[]): Promise<CreateRequestsResult> {
  const today = todayKey();
  const maxDate = addDays(today, MAX_AHEAD_DAYS);

  // 1차: 날짜·사유·유형·모드처럼 구조적으로 검증 가능한 값만 먼저 정리한다(아직 시간 환산은 안 함 —
  // late/early/absent 는 그 날짜(요일)의 정기 등·하원 시각이 있어야 계산할 수 있어서 아래에서 한 번에 조회한다).
  type Prelim = {
    date: string; reasonOpt: (typeof SCHEDULE_REASONS)[number]; title: string;
    reqType: RequestType; raw: RequestTypeRawInput; skipRuleId: string | null;
  };
  const prelim: Prelim[] = [];
  for (const it of items) {
    const date = typeof it.date === "string" ? it.date : "";
    if (!DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
    if (date < today) return { ok: false, error: `${dateLabelOf(date)}은(는) 이미 지난 날짜예요.` };
    if (date > maxDate) return { ok: false, error: `${dateLabelOf(date)}은(는) 오늘로부터 ${MAX_AHEAD_DAYS}일 이내만 신청할 수 있어요.` };

    const reasonOpt = SCHEDULE_REASONS.find((r) => r.key === it.reasonKey);
    if (!reasonOpt) return { ok: false, error: "사유를 확인해주세요." };

    const reqType = typeof it.reqType === "string" && REQ_TYPE_KEYS.has(it.reqType) ? (it.reqType as RequestType) : null;
    if (!reqType) return { ok: false, error: "신청 유형을 확인해주세요." };

    // raw 는 클라가 만든 원값(0~1439 minute-of-day)일 뿐 — reqType 자체 기준으로 서버가 다시 구성한다
    // (raw.type 필드는 신뢰하지 않고 무시, reqType 으로만 분기).
    const ro = (it.raw && typeof it.raw === "object" ? it.raw : {}) as Record<string, unknown>;
    let raw: RequestTypeRawInput;
    if (reqType === "absent") {
      raw = { type: "absent" };
    } else if (reqType === "late") {
      if (!isRawMin(ro.arrive)) return { ok: false, error: "등원 시각을 확인해주세요." };
      raw = { type: "late", arrive: ro.arrive };
    } else if (reqType === "early") {
      if (!isRawMin(ro.leave)) return { ok: false, error: "하원 시각을 확인해주세요." };
      raw = { type: "early", leave: ro.leave };
    } else if (reqType === "out") {
      if (!isRawMin(ro.leaveAt) || !isRawMin(ro.returnAt)) return { ok: false, error: "외출 시간을 확인해주세요." };
      raw = { type: "out", leaveAt: ro.leaveAt, returnAt: ro.returnAt };
    } else {
      if (!isRawMin(ro.start) || !isRawMin(ro.end)) return { ok: false, error: "시간을 확인해주세요." };
      raw = { type: "custom", start: ro.start, end: ro.end };
    }

    const title = typeof it.title === "string" ? it.title.trim().slice(0, 60) : "";
    const mode = it.mode === "replace" ? "replace" : it.mode === "add" ? "add" : null;
    if (!mode) return { ok: false, error: "신청 방식을 확인해주세요." };

    let skipRuleId: string | null = null;
    if (mode === "replace") {
      const raw2 = typeof it.skipRuleId === "string" ? it.skipRuleId : "";
      if (!UUID_RE.test(raw2)) return { ok: false, error: "대체할 정기 일정을 다시 선택해주세요." };
      skipRuleId = raw2;
    }

    prelim.push({ date, reasonOpt, title, reqType, raw, skipRuleId });
  }

  // 2차: 배치에 등장하는 요일들의 정기 등·하원 시각(schedule_hours)을 한 번에 조회해 각 항목을 환산한다.
  // dow 는 weekdayOf() 로 서버가 계산한 정수(1~7)라 리터럴 IN 절에 안전하게 쓸 수 있다.
  const dows = [...new Set(prelim.map((p) => dow1to7(p.date)))];
  const hoursByDow = new Map<number, { arrive_min: number; leave_min: number }>();
  if (dows.length > 0) {
    const hr = await db.query<{ day: number; arrive_min: number; leave_min: number }>(
      `select day, arrive_min, leave_min from schedule_hours where branch_id=$1 and student_id=$2 and day in (${dows.join(",")})`,
      [branch, studentId],
    );
    for (const row of hr.rows) hoursByDow.set(row.day, { arrive_min: row.arrive_min, leave_min: row.leave_min });
  }

  type Clean = { date: string; kind: ScheduleKind; reason: string; title: string; reqType: RequestType; start: number; end: number; skipRuleId: string | null };
  const clean: Clean[] = [];
  for (const p of prelim) {
    const hours = hoursByDow.get(dow1to7(p.date)) ?? null;
    const resolved = resolveRequestRange(p.raw, hours);
    if (!resolved.ok) return { ok: false, error: `${dateLabelOf(p.date)}: ${resolved.error}` };
    clean.push({
      date: p.date, kind: p.reasonOpt.kind, reason: p.reasonOpt.label, title: p.title,
      reqType: p.reqType, start: resolved.start, end: resolved.end, skipRuleId: p.skipRuleId,
    });
  }

  // "대체" 로 낸 항목의 skipRuleId 가 실제로 이 학생 소유이고, 그 날짜 요일에 걸려 있는 규칙인지 확인.
  const replaceIds = [...new Set(clean.filter((c) => c.skipRuleId).map((c) => c.skipRuleId as string))];
  if (replaceIds.length > 0) {
    // regex(UUID_RE) 로 이미 검증된 값만 모았으므로 리터럴로 안전하게 IN 절에 넣는다(배열 파라미터 회피 —
    // fetch_types:false 인 운영 드라이버는 타입 정보 없이 배열 바인딩을 못 한다).
    const inList = replaceIds.map((v) => `'${v}'`).join(",");
    const r = await db.query<{ id: string; days: string }>(
      `select id, days from schedule_rule where branch_id=$1 and student_id=$2 and id in (${inList})`,
      [branch, studentId],
    );
    const daysById = new Map(r.rows.map((row) => [row.id, row.days.split(",").map(Number)]));
    for (const c of clean) {
      if (!c.skipRuleId) continue;
      const days = daysById.get(c.skipRuleId);
      if (!days || !days.includes(dow1to7(c.date))) {
        return { ok: false, error: "대체할 정기 일정을 다시 선택해주세요." };
      }
    }
  }

  // 중복 신청(같은 학생·같은 날짜·같은 시간대의 대기/승인 건) 거부 — 배열 파라미터 없이 날짜 범위 하나로
  // 후보를 뽑아 메모리에서 정확히 대조한다.
  const minDate = clean.reduce((a, c) => (c.date < a ? c.date : a), clean[0].date);
  const maxDateOfBatch = clean.reduce((a, c) => (c.date > a ? c.date : a), clean[0].date);
  const existing = await db.query<{ date: string; start_min: number; end_min: number }>(
    `select date::text as date, start_min, end_min from schedule_request
      where branch_id=$1 and student_id=$2 and status in ('pending','approved') and date between $3 and $4`,
    [branch, studentId, minDate, maxDateOfBatch],
  );
  for (const c of clean) {
    const dup = existing.rows.find((e) => e.date === c.date && e.start_min === c.start && e.end_min === c.end);
    if (dup) return { ok: false, error: `${dateLabelOf(c.date)} ${fmtRange(c.start, c.end)} 신청이 이미 있어요.` };
  }
  // 같은 배치 안에서도 완전히 같은 (날짜,시작,종료) 가 중복되면 거부.
  for (let i = 0; i < clean.length; i++) {
    for (let j = i + 1; j < clean.length; j++) {
      if (clean[i].date === clean[j].date && clean[i].start === clean[j].start && clean[i].end === clean[j].end) {
        return { ok: false, error: "같은 시간대를 두 번 신청했어요." };
      }
    }
  }

  const params: (string | number | null)[] = [branch, studentId];
  const values = clean.map((c) => {
    const base = params.length;
    params.push(c.date, c.kind, c.reason, c.title || null, c.start, c.end, c.skipRuleId, c.reqType);
    return `($1,$2,$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},'temp')`;
  });
  // 위에서 이미 select 로 pending/approved 중복을 걸렀지만, 그 select 와 이 insert 사이에 두 번째
  // 탭/기기의 동시 요청이 끼어들면 완전히 같은 (날짜,시작,종료) 가 두 번 들어갈 수 있었다 —
  // schema.modules.ts uq_schedule_request_active_dedup(부분 유니크: status in pending/approved) 로
  // 막고, 여기서는 on conflict do nothing 으로 조용히 건너뛴다(새로 insert 되는 행은 항상
  // status 기본값 'pending' 이라 인덱스 조건과 항상 일치, 충돌 대상 표현식도 인덱스와 동일해야 매칭됨).
  // 걸러진 행은 returning 에 안 나오므로 inserted.rows.length 가 clean.length 보다 작을 수 있다 —
  // 호출부는 이미 rows 개수를 가정하지 않고 그대로 반환하므로 별도 처리 불필요.
  const inserted = await db.query<RequestDbRow>(
    `insert into schedule_request(branch_id, student_id, date, kind, reason, title, start_min, end_min, skip_rule_id, req_type, req_kind)
     values ${values.join(",")}
     on conflict (branch_id, student_id, date, start_min, end_min) where status in ('pending','approved')
     do nothing
     returning ${REQUEST_ROW_COLS}`,
    params,
  );

  // 자동 승인 켜져 있으면 방금 만든 신청들을 같은 승인 경로로 즉시 처리한다.
  if (await isAutoApproveOn(branch)) {
    // gen_random_uuid() 로 방금 만든 서버측 id 라 안전하게 리터럴로 IN 절에 넣는다(배열 파라미터 회피).
    const idList = inserted.rows.map((row) => `'${row.id}'`).join(",");
    for (const row of inserted.rows) {
      await approveScheduleRequest(row.id, branch, null);
    }
    const refreshed = await db.query<RequestDbRow>(
      `select ${REQUEST_ROW_COLS} from schedule_request where id in (${idList})`,
    );
    return { ok: true, rows: refreshed.rows.map(toMyRow) };
  }

  return { ok: true, rows: inserted.rows.map(toMyRow) };
}

// ---------------- 내 신청 목록 ----------------
export type ListMyRequestsResult = { ok: true; rows: MyRequestRow[] } | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test. */
export async function listMyRequests(formData: FormData): Promise<ListMyRequestsResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) return { ok: true, rows: [] };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const r = await db.query<RequestDbRow>(
    `select ${REQUEST_ROW_COLS} from schedule_request where branch_id=$1 and student_id=$2
      order by created_at desc`,
    [branch, id.studentId],
  );
  return { ok: true, rows: r.rows.map(toMyRow) };
}

// ---------------- 신청 취소(대기 중만) ----------------
export type CancelRequestResult = { ok: true } | { ok: false; error: string; kind?: "identity" };

/** FormData: slug, name, code, (개발전용) test, id. */
export async function cancelRequest(formData: FormData): Promise<CancelRequestResult> {
  await ready();
  const id = await verifyIdentity(formData);
  if (!id.ok) return id;
  if (id.testBypass || !id.studentId) {
    return { ok: false, error: "테스트 신원으로는 취소할 수 없어요." };
  }
  const reqId = s(formData.get("id"));
  if (!UUID_RE.test(reqId)) return { ok: false, error: "요청이 올바르지 않습니다." };

  const r = await db.query(
    `delete from schedule_request where id=$1 and student_id=$2 and status='pending' returning id`,
    [reqId, id.studentId],
  );
  if (r.rows.length === 0) return { ok: false, error: "이미 처리되었거나 찾을 수 없는 신청이에요." };
  return { ok: true };
}
