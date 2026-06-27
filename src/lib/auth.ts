// 인증·계정 핵심 — 여기서 Supabase를 격리. 호출부는 authenticate()/getMe()/provision()만 본다.
// 로그인 = ID+PIN. 내부적으로 person.auth_email + PIN→비번 으로 Supabase Auth 로그인.
import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Me, BranchMembership } from '@/lib/perms';

// ID 정규화: 영어 대소문자 무시(소문자), 양끝 공백 제거. 한글·숫자는 그대로.
export function normalizeLoginId(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}
// 4자리 PIN → Auth 비밀번호(최소길이 회피용 접두)
export function pinToPassword(pin: string): string {
  return `sq_${pin}`;
}

// 로그인. 성공 시 세션쿠키 세팅. 실패 시 에러 메시지 반환.
export async function authenticate(loginIdRaw: string, pin: string): Promise<string | null> {
  const loginId = normalizeLoginId(loginIdRaw);
  if (!loginId || !/^\d{6}$/.test(pin)) return '아이디와 6자리 PIN을 확인하세요';

  const admin = createAdminClient();
  const { data: person } = await admin
    .from('person')
    .select('auth_email, status')
    .eq('login_id', loginId)
    .maybeSingle();
  if (!person) return '존재하지 않는 아이디입니다';
  if (person.status !== 'active') return '비활성 계정입니다';

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: person.auth_email,
    password: pinToPassword(pin),
  });
  if (error) return 'PIN이 일치하지 않습니다';
  return null;
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// 현재 로그인 사용자 조립 (없으면 null)
export async function getMe(): Promise<Me | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: person } = await supabase
    .from('person')
    .select('id, login_id, name')
    .eq('id', user.id)
    .maybeSingle();
  if (!person) return null;

  // 소속·역할
  const { data: prRows } = await supabase
    .from('person_role')
    .select('branch_id, role:role(id,key,label,rank), branch:branch(id,name,is_hq)')
    .eq('person_id', user.id);

  type Row = {
    branch_id: string;
    role: { id: string; key: string; label: string; rank: number } | null;
    branch: { id: string; name: string; is_hq: boolean } | null;
  };
  const rows = (prRows ?? []) as unknown as Row[];

  const branchMap = new Map<string, BranchMembership>();
  const roleIds = new Set<string>();
  let isCto = false;
  for (const r of rows) {
    if (!r.branch || !r.role) continue;
    roleIds.add(r.role.id);
    if (r.role.key === 'cto') isCto = true;
    const b = branchMap.get(r.branch.id) ?? {
      id: r.branch.id, name: r.branch.name, isHq: r.branch.is_hq, roles: [],
    };
    b.roles.push({ key: r.role.key, label: r.role.label, rank: r.role.rank });
    branchMap.set(r.branch.id, b);
  }
  const branches = Array.from(branchMap.values());

  // 활성 지점: 본점 우선 → 없으면 첫 지점
  const active = branches.find((b) => b.isHq) ?? branches[0];
  const activeBranchId = active?.id ?? '';

  // 활성 지점의 권한 집합
  const activeRoleIds = rows
    .filter((r) => r.branch?.id === activeBranchId && r.role)
    .map((r) => r.role!.id);
  let perms: string[] = [];
  if (activeRoleIds.length) {
    const { data: rp } = await supabase
      .from('role_permission')
      .select('permission_key, role_id')
      .in('role_id', activeRoleIds);
    perms = Array.from(new Set((rp ?? []).map((x) => x.permission_key as string)));
  }

  return {
    id: person.id,
    loginId: person.login_id,
    name: person.name,
    isCto,
    activeBranchId,
    branches,
    perms,
  };
}

// 계정 발급 (account.provision 보유자만 — 호출 서버액션에서 권한 검증 후 사용)
export async function provisionAccount(opts: {
  loginId: string; pin: string; name: string; phone?: string;
  branchId: string; roleKey: string; createdBy?: string;
}): Promise<string> {
  const admin = createAdminClient();
  const loginId = normalizeLoginId(opts.loginId);
  if (!loginId) throw new Error('아이디 필요');
  if (!/^\d{6}$/.test(opts.pin)) throw new Error('PIN은 6자리 숫자');

  const authEmail = `${globalThis.crypto.randomUUID()}@sq.local`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password: pinToPassword(opts.pin),
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(error?.message ?? 'Auth 계정 생성 실패');
  const uid = created.user.id;

  const { data: role, error: rErr } = await admin
    .from('role').select('id').eq('key', opts.roleKey).single();
  if (rErr || !role) throw new Error('역할 없음: ' + opts.roleKey);

  const { error: pErr } = await admin.from('person').insert({
    id: uid, login_id: loginId, auth_email: authEmail,
    name: opts.name, phone: opts.phone ?? null, created_by: opts.createdBy ?? null,
  });
  if (pErr) { await admin.auth.admin.deleteUser(uid); throw new Error('person 생성 실패: ' + pErr.message); }

  const { error: prErr } = await admin.from('person_role')
    .insert({ person_id: uid, branch_id: opts.branchId, role_id: role.id });
  if (prErr) throw new Error('역할 부여 실패: ' + prErr.message);

  return uid;
}
