// 직원 근태(QR 출퇴근) 도메인 로직 — 토큰 서명·검증, 펜딩 로그인 쿠키 서명·검증, 지각·조퇴 판정
// 순수 함수, DB 펀치(punch) 기록. src/lib/staff-schedule.ts(겹침 판정)와 같은 위치의 "직원 근태 단일
// 출처" 파일이다. DB·crypto·쿠키를 다루므로 서버 전용.
import "server-only";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "./db";
import { secret } from "./auth";
import { todayKey, minuteOfKST } from "./date";

/** 접속 IP — 차단 목적이 아니라 "나중에 특정 IP로 제한할 수 있게 값만 남긴다"는 요구사항용 기록.
 *  Vercel 은 프록시 뒤에서 x-forwarded-for 첫 값이 실제 클라이언트 IP다. 로컬 개발(PGlite)엔 이
 *  헤더가 없어 null — 기록만 비고 기능은 그대로 동작한다(오탐으로 출근을 막지 않는다는 원칙과 같은
 *  이유로, IP 를 못 구해도 펀치 자체는 절대 막지 않는다). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

// ── QR 표시 주기 · 토큰 수명 ──────────────────────────────────────────────
// 키오스크가 QR 을 다시 그리는 주기. 폰 카메라가 초점을 맞추고 디코딩하는 데 보통 1~2초 걸리므로
// 그보다 훨씬 길게 잡아야 "찍었는데 그새 바뀌어서 실패"가 잦아지지 않는다. 6초.
export const QR_REFRESH_SECONDS = 6;
// 토큰 자체의 유효시간. 화면 주기(6초)+스캔·리다이렉트 왕복 여유를 더해 20초로 잡는다 — 카운터에
// 화면이 6초마다 바뀌므로 어차피 20초짜리 여유는 최대 2~3장의 QR 만 유효구간을 스치고, 사진으로
// 옮겨 다른 사람에게 전달하는 시간(수십 초~수 분)보다는 훨씬 짧아 "찍어서 집에서 쓰기"를 사실상
// 막는다. 반대로 카메라가 느려도 스캔 성공까지는 보통 20초면 충분하다.
export const QR_TTL_SECONDS = 20;
// 로그인 안 된 상태로 스캔했을 때, 로그인 완료 후 자동으로 출퇴근을 이어 처리할 수 있는 유예시간.
// 아이디·비밀번호를 처음 치는 상황(오타 재시도 포함)까지 감안해 넉넉히 10분.
const PENDING_TTL_SECONDS = 600;

function hmac(msg: string): string {
  return createHmac("sha256", secret()).update(msg).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ── QR 토큰: "{id}.{exp초}.{서명}" ───────────────────────────────────────
// id 는 staff_attendance_qr 행의 PK. exp 는 토큰 문자열 자체에도 넣어 서명 검증만으로(DB 왕복 없이)
// 만료를 즉시 걸러낼 수 있게 한다 — 실제 1회용 소진 여부는 어차피 DB 로만 판정 가능하므로 그 앞단
// 필터일 뿐이다. 서명 메시지에 "qr:" 접두사를 붙여 세션 쿠키 서명과 절대 섞이지 않게 한다.
export function signQrToken(id: string, expEpochSec: number): string {
  return `${id}.${expEpochSec}.${hmac(`qr:${id}:${expEpochSec}`)}`;
}
function verifyQrTokenShape(token: string): { id: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!id || !Number.isFinite(exp)) return null;
  if (!safeEqual(sig, hmac(`qr:${id}:${expStr}`))) return null;
  return { id, exp };
}

export type QrIssue = { token: string; url: string; expiresAt: number };

/** 키오스크가 새 QR 을 그릴 때 호출 — DB 에 발급 행을 만들고 서명된 토큰·절대경로 URL 을 돌려준다.
 *  키오스크 한 대가 6초마다(QR_REFRESH_SECONDS) 한 행씩 만들므로 청소 없이 두면 시간당 600행씩
 *  무한히 쌓인다. 부팅 마이그레이션(스키마 버전이 바뀔 때만 도는 일회성)이나 별도 cron 대신 "발급
 *  시점에 같이 지운다"를 골랐다 — 이 함수 자체가 6초마다 불리는 자연스러운 청소 타이밍이라 스케줄러가
 *  따로 필요 없고, 키오스크가 멈추면(더 발급 안 하면) 그 지점 행도 더는 안 쌓이므로 "쓰는 만큼만
 *  청소"가 맞아떨어진다. 만료 후 1시간 지난 것만 지워, 방금 소진된 토큰의 used_by/used_ip 를 잠깐은
 *  들여다볼 수 있게 남겨둔다. */
export async function issueQrToken(branchId: string, baseUrl: string): Promise<QrIssue> {
  const id = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + QR_TTL_SECONDS;
  await db.query(`delete from staff_attendance_qr where expires_at < now() - interval '1 hour'`);
  await db.query(
    `insert into staff_attendance_qr(id, branch_id, expires_at) values ($1,$2, to_timestamp($3))`,
    [id, branchId, exp],
  );
  const token = signQrToken(id, exp);
  return { token, url: `${baseUrl}/m/staff/attendance/scan/${token}`, expiresAt: exp };
}

export type QrScanResult =
  | { ok: true; branchId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** 스캔 시점에 토큰을 1회용으로 소진한다. 로그인 여부와 무관하게 "물리적 QR 한 장"을 여기서 태운다
 *  — usedBy 는 그 순간 로그인돼 있으면 채우고, 아니면 null(펜딩 흐름이 나중에 이어받는다). */
export async function consumeQrToken(token: string, personId: string | null, ip: string | null): Promise<QrScanResult> {
  const shape = verifyQrTokenShape(token);
  if (!shape) return { ok: false, reason: "invalid" };
  if (shape.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  const upd = await db.query<{ branch_id: string }>(
    `update staff_attendance_qr set used_at=now(), used_by=$2, used_ip=$3
      where id=$1 and used_at is null and expires_at > now()
      returning branch_id`,
    [shape.id, personId, ip],
  );
  if (upd.rows[0]) return { ok: true, branchId: upd.rows[0].branch_id };

  // 갱신이 안 됐다 — 이미 소진됐는지 애초에 없는(DB 에서 지워지지 않으므로 사실상 만료뿐인) 토큰인지
  // 구분해 사람이 이해할 수 있는 이유를 돌려준다.
  const row = await db.query<{ used_at: string | null; expires_at: string }>(
    `select used_at, expires_at from staff_attendance_qr where id=$1`,
    [shape.id],
  );
  if (!row.rows[0]) return { ok: false, reason: "invalid" };
  if (row.rows[0].used_at) return { ok: false, reason: "used" };
  return { ok: false, reason: "expired" };
}

// ── 로그인 전 스캔 → 로그인 후 자동 이어붙이기용 펜딩 쿠키 ────────────────
// 쿠키 값 = "{branchId}.{발급초}.{서명}". QR 토큰 자체는 스캔 즉시 소진했으므로 여기 담는 건 "어느
// 지점 QR 이었는지"뿐 — 로그인 완료 후 continue 페이지가 이 값으로 통상적인 펀치 기록을 한 번 더
// 만든다(사람은 로그인 성공 시점의 me.id 로 정해지므로 쿠키에 사람을 담을 필요가 없다).
export function signPendingCookie(branchId: string): string {
  const issued = Math.floor(Date.now() / 1000);
  return `${branchId}.${issued}.${hmac(`pending:${branchId}:${issued}`)}`;
}
export function verifyPendingCookie(value: string): { branchId: string } | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [branchId, issuedStr, sig] = parts;
  const issued = Number(issuedStr);
  if (!branchId || !Number.isFinite(issued)) return null;
  if (!safeEqual(sig, hmac(`pending:${branchId}:${issuedStr}`))) return null;
  if (Math.floor(Date.now() / 1000) - issued > PENDING_TTL_SECONDS) return null;
  return { branchId };
}
export const PENDING_COOKIE = "sq_pending_att";

// ── 출퇴근 펀치 기록 ───────────────────────────────────────────────────
export type PunchResult = { kind: "in" | "out"; date: string; at: string };

/** 오늘 그 사람의 마지막 기록이 없거나 'out'이면 이번은 출근('in'), 마지막이 'in'이면 이번은
 *  퇴근('out') — 하루 안에서 출근·퇴근이 번갈아 온다고 보는 가장 단순한 규칙. 같은 사람이 같은 날
 *  세 번째로 찍으면(예: 외출 후 재입실) 다시 출근으로 잡힌다 — 지금은 "그날 최초 출근·최후 퇴근"만
 *  지각·조퇴 판정에 쓰므로(judgeDay 참고) 중간에 몇 번을 더 찍어도 그 판정엔 영향이 없다. */
export async function recordPunch(
  branchId: string, personId: string, ip: string | null, source: "qr" | "manual",
): Promise<PunchResult> {
  const date = todayKey();
  const last = await db.query<{ kind: string }>(
    `select kind from staff_attendance where branch_id=$1 and person_id=$2 and date=$3 order by at desc limit 1`,
    [branchId, personId, date],
  );
  const kind: "in" | "out" = last.rows[0]?.kind === "in" ? "out" : "in";
  const at = new Date();
  await db.query(
    `insert into staff_attendance(branch_id, person_id, date, kind, at, source, ip, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [branchId, personId, date, kind, at.toISOString(), source, ip, personId],
  );
  return { kind, date, at: at.toISOString() };
}

// ── 지각·조퇴 판정 (순수 함수 — 화면·서버가 같은 규칙을 쓴다) ─────────────
export type DayJudgement = "onTime" | "late" | "early" | "lateAndEarly" | "noSchedule" | "absent" | "notYet";

/** 그날 근무표(staff_schedule) 여러 건 중 가장 이른 시작·가장 늦은 종료를 "그날 근무 범위"로 본다 —
 *  카운터 근무 하나만 있는 날이 대부분이지만 수업·상담이 섞여도 "그 사람이 그날 언제부터 언제까지
 *  매여 있었는지"가 관심사이지 개별 블록 단위 출입이 아니기 때문이다. 근무표가 아예 없는 날은 비교
 *  기준이 없으므로 지각·조퇴를 매기지 않는다(noSchedule) — 임시로 나온 날, 대타 등 근무표를 안 짠
 *  날까지 "지각"으로 몰면 오탐이 신뢰를 깎는다(집주인 지시: 근무표 없는 날 처리는 판단해서 근거와
 *  함께 보고).
 *
 *  근무표는 있는데 in/out 기록이 하나도 없는 경우: 예전엔 그냥 "정상"으로 떨어졌다(버그) — 아무도
 *  안 찍었는데 초록 배지가 뜨는 건 이 함수가 막아야 할 바로 그 오탐이다. 다만 "아직 근무 시작 전"인
 *  당일까지 성급하게 "결근"으로 몰면 그것도 오탐이라(교대 시작 전 오전에 관리자가 화면을 열어보는
 *  경우가 흔하다), 그 구간엔 하루가 이미 끝났는지(dayEnded — 호출부가 오늘 날짜면 현재 KST 시각이
 *  근무 종료 시각을 지났는지로, 과거 날짜면 항상 true 로 넘긴다)로 갈라 "미기록"(notYet)과
 *  "결근"(absent)을 구분한다. */
export function judgeDay(
  scheduleStart: number | null, scheduleEnd: number | null,
  firstInMin: number | null, lastOutMin: number | null,
  dayEnded: boolean,
): DayJudgement {
  if (scheduleStart == null || scheduleEnd == null) return "noSchedule";
  if (firstInMin == null && lastOutMin == null) return dayEnded ? "absent" : "notYet";
  const late = firstInMin != null && firstInMin > scheduleStart;
  const early = lastOutMin != null && lastOutMin < scheduleEnd;
  if (late && early) return "lateAndEarly";
  if (late) return "late";
  if (early) return "early";
  return "onTime";
}

export const JUDGEMENT_LABEL: Record<DayJudgement, string> = {
  onTime: "정상", late: "지각", early: "조퇴", lateAndEarly: "지각·조퇴", noSchedule: "근무표 없음",
  absent: "결근", notYet: "미기록",
};

/** timestamptz 문자열 → KST 분(minuteOfKST) 래퍼 — 이 파일에서 firstIn/lastOut 계산에만 쓰여
 *  이름을 붙여둔다. */
export function minOf(at: string): number {
  return minuteOfKST(at);
}
