// 마스터 CTO 계정 1회 생성. 실행: node scripts/bootstrap.mjs
// 전제: supabase/schema.sql 을 먼저 SQL Editor에서 실행해 둘 것.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// .env.local 수동 로드
const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(
  raw.split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('환경변수 없음 (.env.local 확인)'); process.exit(1); }

const admin = createClient(url, key, { auth: { persistSession: false } });

const LOGIN_ID = '나한결';
const PIN = '365785';
const NAME = '나한결';
const HQ = '00000000-0000-0000-0000-000000000001';

// 레거시 마스터 정리 (auth 유저 삭제 → person/person_role cascade)
for (const legacy of ['ra한결']) {
  const { data: old } = await admin.from('person').select('id').eq('login_id', legacy).maybeSingle();
  if (old) { await admin.auth.admin.deleteUser(old.id); console.log('레거시 삭제:', legacy); }
}

const { data: existing } = await admin.from('person').select('id').eq('login_id', LOGIN_ID).maybeSingle();
if (existing) { console.log('이미 존재:', LOGIN_ID); process.exit(0); }

const authEmail = `${crypto.randomUUID()}@sq.local`;
const { data: created, error } = await admin.auth.admin.createUser({
  email: authEmail, password: `sq_${PIN}`, email_confirm: true,
});
if (error) { console.error('Auth 생성 실패:', error.message); process.exit(1); }
const uid = created.user.id;

const { data: role, error: rErr } = await admin.from('role').select('id').eq('key', 'cto').single();
if (rErr || !role) { console.error('cto 역할 없음 — schema.sql 먼저 실행'); process.exit(1); }

const { error: pErr } = await admin.from('person').insert({
  id: uid, login_id: LOGIN_ID, auth_email: authEmail, name: NAME,
});
if (pErr) { console.error('person 실패:', pErr.message); process.exit(1); }

const { error: prErr } = await admin.from('person_role').insert({
  person_id: uid, branch_id: HQ, role_id: role.id,
});
if (prErr) { console.error('person_role 실패:', prErr.message); process.exit(1); }

console.log(`마스터 CTO 생성 완료 → 아이디: ${LOGIN_ID} / PIN: ${PIN}`);
process.exit(0);
