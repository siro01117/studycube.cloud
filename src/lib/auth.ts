import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { ready } from "./bootstrap";
import { verifyPin } from "./hash";
import { PERMISSIONS } from "./perms";

// 로컬 개발용 세션 = 서명된 쿠키(person id). 배포 때 Supabase Auth로 교체.
const SECRET = "dev-secret-studycube-change-on-deploy";
const COOKIE = "sq_session";

function sign(id: string): string {
  return createHmac("sha256", SECRET).update(id).digest("hex");
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

// 아이디 정규화: 앞뒤 공백 제거 + 영어 소문자 (한글은 그대로)
function normId(s: string): string {
  return s.trim().toLowerCase();
}

/** ID + PIN 검증. 맞으면 Me, 틀리면 null */
export async function authenticate(loginId: string, pin: string): Promise<Me | null> {
  await ready();
  const id = normId(loginId);
  const r = await db.query<{
    id: string; login_id: string; name: string; pin_hash: string; is_cto: boolean; active: boolean;
  }>(`select id, login_id, name, pin_hash, is_cto, active from person where lower(login_id) = $1`, [id]);
  const p = r.rows[0];
  if (!p || !p.active) return null;
  if (!verifyPin(pin, p.pin_hash)) return null;
  const ctx = await resolveContext(p.id, p.is_cto);
  return { id: p.id, loginId: p.login_id, name: p.name, isCto: p.is_cto, ...ctx };
}

export async function setSession(personId: string, remember: boolean): Promise<void> {
  const c = await cookies();
  c.set(COOKIE, makeToken(personId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

export async function clearSession(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE);
}

/** 현재 로그인 사용자 (없으면 null) */
export async function getMe(): Promise<Me | null> {
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
