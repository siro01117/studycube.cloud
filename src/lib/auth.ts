import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { ready } from "./bootstrap";
import { verifyPin } from "./hash";
import { PERMISSIONS } from "./perms";
import { normalizeLoginId } from "./hangul-romanize";

// 직원 로그인 무차별 대입 방어 파라미터 — 학생 공개 폼(access_attempt, apply/actions.ts)과 같은 값.
const LOGIN_ATTEMPT_WINDOW = "15 minutes";
const LOGIN_ATTEMPT_THRESHOLD = 10;
const LOGIN_ATTEMPT_LOCK = "15 minutes";

// 세션 = 서명된 쿠키(person id). 배포 때 Supabase Auth로 교체 예정.
const COOKIE = "sq_session";

// 서명키. 저장소에 상수로 박아두면 공개 저장소에서 세션 위조가 가능하므로
// ① SESSION_SECRET 환경변수 → ② 접속문자열(배포 환경에만 존재)에서 파생 → ③ 로컬 전용 고정값.
// export: 근태 QR 토큰 서명(src/lib/staff-attendance.ts)도 같은 키 파생 규칙을 쓴다 — 새 비밀값을
// env/DB에 따로 두지 않고 이미 검증된 세션 서명 규칙(① SESSION_SECRET → ② 접속문자열 파생 → ③ 로컬
// 고정값)을 재사용한다. 세션 쿠키와 QR 토큰은 서명 대상 문자열에 용도 접두사(예: "qr:")를 붙여
// 구분하므로 같은 키를 써도 한쪽 서명을 다른 쪽에 재사용(replay)할 수 없다.
let cachedSecret: string | null = null;
export function secret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env.SESSION_SECRET;
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  cachedSecret = env
    ? env
    : dbUrl
      ? createHash("sha256").update(`studycube:session:${dbUrl}`).digest("hex")
      : "dev-only-local-secret";
  return cachedSecret;
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("hex");
}
function makeToken(id: string): string {
  return `${id}.${sign(id)}`;
}
function readToken(tok: string | undefined): string | null {
  if (!tok) return null;
  const i = tok.lastIndexOf(".");
  if (i < 0) return null;
  const id = tok.slice(0, i);
  const sig = tok.slice(i + 1);
  const want = sign(id);
  if (sig.length !== want.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  } catch {
    return null;
  }
  return id;
}

export type Me = {
  id: string;
  loginId: string;
  name: string;
  isCto: boolean;
  activeBranchId: string | null; // 지금은 단일 지점(본점). 다지점 시 선택값.
  perms: string[]; // 활성 지점에서 보유한 권한 키 (CTO는 전 카탈로그)
};

const ALL_PERMS = PERMISSIONS.map((p) => p.key);

/** 권한 판정 — CTO는 전권 bypass */
export function can(me: Me | null, perm: string): boolean {
  if (!me) return false;
  return me.isCto || me.perms.includes(perm);
}

/** 서버액션 가드 — 로그인 + 권한 확인 후 Me 반환 */
export async function guard(perm: string): Promise<Me> {
  const me = await getMe();
  if (!me) throw new Error("로그인이 필요합니다");
  if (!can(me, perm)) throw new Error("권한이 없습니다");
  return me;
}

// 로그인 사용자의 지점·권한 컨텍스트 조립
async function resolveContext(
  personId: string,
  isCto: boolean,
): Promise<{ activeBranchId: string | null; perms: string[] }> {
  if (isCto) {
    // CTO = 전 지점·전권. 활성 지점은 본점(없으면 첫 지점).
    const hq = await db.query<{ id: string }>(
      `select id from branch where code='HQ' order by created_at limit 1`,
    );
    const any = hq.rows[0]
      ? hq.rows[0]
      : (await db.query<{ id: string }>(`select id from branch order by created_at limit 1`)).rows[0];
    return { activeBranchId: any?.id ?? null, perms: ALL_PERMS };
  }
  // 일반 직원 = 소속 지점 중 첫 지점 + 그 지점 역할들의 권한 합집합
  const br = await db.query<{ branch_id: string }>(
    `select distinct branch_id from person_role where person_id=$1 order by branch_id limit 1`,
    [personId],
  );
  const activeBranchId = br.rows[0]?.branch_id ?? null;
  if (!activeBranchId) return { activeBranchId: null, perms: [] };
  const pr = await db.query<{ permission_key: string }>(
    `select distinct rp.permission_key
       from person_role pr
       join role_permission rp on rp.role_id = pr.role_id
      where pr.person_id = $1 and pr.branch_id = $2`,
    [personId, activeBranchId],
  );
  return { activeBranchId, perms: pr.rows.map((r) => r.permission_key) };
}

// 아이디 정규화: 로그인 아이디 입력칸 규칙(영문 소문자·숫자만, 한글은 두벌식 키 입력으로 환원)과
// 항상 같은 함수를 쓴다 — 폼(page.tsx onBlur)과 서버(여기)가 서로 다른 규칙을 쓰면 폼에서 잘 보이던
// 아이디가 서버에서는 안 맞는 사고가 난다. 서버 쪽이 최종 권위(클라이언트 JS 를 신뢰하지 않는다).
function normId(s: string): string {
  return normalizeLoginId(s);
}

async function isLoginLocked(id: string): Promise<boolean> {
  const r = await db.query(
    `select 1 from login_attempt where login_id=$1 and locked_until is not null and locked_until > now()`,
    [id],
  );
  return r.rows.length > 0;
}

// 실패 기록은 실제 계정 존재 여부와 무관하게 "정규화된 입력 문자열" 기준으로 쌓는다 — 존재하지
// 않는 아이디는 잠기지 않는다는 식으로 계정 존재가 새어나가면 안 되기 때문(학생 폼 access_attempt와
// 같은 원칙). 원자적 upsert 로 경쟁 상태 없이 누적·윈도우 리셋·잠금을 한 번에 처리한다.
async function recordLoginFailure(id: string): Promise<void> {
  await db.query(
    `insert into login_attempt(login_id, fails, first_fail) values ($1,1,now())
     on conflict (login_id) do update set
       fails = case when login_attempt.first_fail < now() - interval '${LOGIN_ATTEMPT_WINDOW}' then 1 else login_attempt.fails + 1 end,
       first_fail = case when login_attempt.first_fail < now() - interval '${LOGIN_ATTEMPT_WINDOW}' then now() else login_attempt.first_fail end,
       locked_until = case when (case when login_attempt.first_fail < now() - interval '${LOGIN_ATTEMPT_WINDOW}' then 1 else login_attempt.fails + 1 end) >= ${LOGIN_ATTEMPT_THRESHOLD}
         then now() + interval '${LOGIN_ATTEMPT_LOCK}' else login_attempt.locked_until end`,
    [id],
  );
}

async function clearLoginFailure(id: string): Promise<void> {
  await db.query(`delete from login_attempt where login_id=$1`, [id]);
}

export type AuthOutcome = { ok: true; me: Me } | { ok: false; reason: "locked" | "invalid" };

/** ID + 비밀번호 검증. 성공하면 {ok:true, me}, 실패하면 {ok:false, reason}.
 *  reason="locked" 은 잠금 상태(비밀번호를 아예 확인하지 않음), "invalid" 는 아이디 없음/비밀번호
 *  틀림을 구분 없이 하나로 묶은 것(계정 존재 여부가 오류 문구로 새지 않게 하기 위함, 잠금 여부도
 *  마찬가지로 "존재하는 계정만 잠긴다"는 신호를 주지 않도록 입력 문자열 기준으로 판정한다). */
export async function authenticate(loginId: string, pin: string): Promise<AuthOutcome> {
  await ready();
  const id = normId(loginId);
  if (!id) return { ok: false, reason: "invalid" };
  if (await isLoginLocked(id)) return { ok: false, reason: "locked" };

  const r = await db.query<{
    id: string; login_id: string; name: string; pin_hash: string; is_cto: boolean; active: boolean;
  }>(`select id, login_id, name, pin_hash, is_cto, active from person where lower(login_id) = $1`, [id]);
  const p = r.rows[0];
  if (!p || !p.active || !verifyPin(pin, p.pin_hash)) {
    await recordLoginFailure(id);
    return { ok: false, reason: "invalid" };
  }

  await clearLoginFailure(id);
  const ctx = await resolveContext(p.id, p.is_cto);
  return { ok: true, me: { id: p.id, loginId: p.login_id, name: p.name, isCto: p.is_cto, ...ctx } };
}

export async function setSession(personId: string, remember: boolean): Promise<void> {
  const c = await cookies();
  c.set(COOKIE, makeToken(personId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // https 에서만 전송
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE);
}

/** 현재 로그인 사용자 (없으면 null).
 *  한 요청 안에서 레이아웃·페이지·서버액션이 각자 호출하므로 cache 로 묶어
 *  같은 요청에서는 DB 조회를 한 번만 한다. (요청이 끝나면 캐시도 사라진다) */
export const getMe = cache(loadMe);

async function loadMe(): Promise<Me | null> {
  const c = await cookies();
  const id = readToken(c.get(COOKIE)?.value);
  if (!id) return null;
  await ready();
  const r = await db.query<{ id: string; login_id: string; name: string; is_cto: boolean; active: boolean }>(
    `select id, login_id, name, is_cto, active from person where id = $1`,
    [id],
  );
  const p = r.rows[0];
  if (!p || !p.active) return null;
  const ctx = await resolveContext(p.id, p.is_cto);
  return { id: p.id, loginId: p.login_id, name: p.name, isCto: p.is_cto, ...ctx };
}
