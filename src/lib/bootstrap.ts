// 코어 스키마 + 시드 (로컬 개발용, 멱등 — 여러 번 돌려도 안전).
// 배포 때는 같은 내용을 Supabase 마이그레이션 SQL로 옮김.
import { db } from "./db";
import { hashPin } from "./hash";
import { PERMISSIONS } from "./perms";
import { MODULES } from "./modules";
import { MODULE_SQL } from "./schema.modules";

const CORE_SQL = `
-- gen_random_uuid() 는 Postgres 13+ 코어 내장 (pgcrypto 불필요)

-- 지점
create table if not exists branch(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  is_hq boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 사람 = 직원 로그인 계정 (학생은 여기 없음)
create table if not exists person(
  id uuid primary key default gen_random_uuid(),
  login_id text unique not null,
  name text not null,
  pin_hash text not null,
  is_cto boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 역할 (앱에서 자유롭게 생성). branch_id null이면 전역 역할
create table if not exists role(
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branch(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz not null default now()
);

-- 권한 카탈로그 (고정 키)
create table if not exists permission(
  key text primary key,
  label text not null,
  category text
);

-- 역할 ↔ 권한 (여기가 "누가 뭘 할 수 있나"의 정답, 앱에서 조정)
create table if not exists role_permission(
  role_id uuid references role(id) on delete cascade,
  permission_key text references permission(key) on delete cascade,
  primary key(role_id, permission_key)
);

-- 사람 ↔ 지점 ↔ 역할 (한 사람이 여러 지점·역할 가능)
create table if not exists person_role(
  id uuid primary key default gen_random_uuid(),
  person_id uuid references person(id) on delete cascade,
  branch_id uuid references branch(id) on delete cascade,
  role_id uuid references role(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(person_id, branch_id, role_id)
);

-- 모듈 카탈로그
create table if not exists module(
  key text primary key,
  label text not null,
  icon text,
  requires text[] not null default '{}',
  ord int not null default 100
);

-- 지점별 모듈 on/off
create table if not exists branch_module(
  branch_id uuid references branch(id) on delete cascade,
  module_key text references module(key) on delete cascade,
  enabled boolean not null default true,
  primary key(branch_id, module_key)
);

create index if not exists idx_person_role_person on person_role(person_id);
create index if not exists idx_person_role_branch on person_role(branch_id);
`;

let booted: Promise<void> | null = null;

/** 코어 스키마·시드를 한 번만 실행하고, 이후엔 즉시 반환 */
export function ready(): Promise<void> {
  return (booted ??= boot());
}

async function boot() {
  await db.exec(CORE_SQL);
  await db.exec(MODULE_SQL); // 이식된 모듈 테이블
  // 상태 모델 변경(2026-07-20): 퇴원(withdrawn) 폐지 → 휴원(leave)로 통합
  await db.query(`update student set status='leave' where status='withdrawn'`);

  // 권한 카탈로그
  for (const p of PERMISSIONS) {
    await db.query(
      `insert into permission(key,label,category) values ($1,$2,$3)
       on conflict (key) do update set label=excluded.label, category=excluded.category`,
      [p.key, p.label, p.category],
    );
  }

  // 모듈 카탈로그
  for (const m of MODULES) {
    const arr = `{${m.requires.join(",")}}`;
    await db.query(
      `insert into module(key,label,requires,ord) values ($1,$2,$3::text[],$4)
       on conflict (key) do update set label=excluded.label, requires=excluded.requires, ord=excluded.ord`,
      [m.key, m.label, arr, m.ord],
    );
  }

  // 본점 1개
  await db.query(
    `insert into branch(name,code,is_hq)
     select '본점','HQ',true where not exists (select 1 from branch where code='HQ')`,
  );
  const hq = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  const hqId = hq.rows[0].id;

  // 본점 모듈 on/off — MVP만 켬
  for (const m of MODULES) {
    await db.query(
      `insert into branch_module(branch_id,module_key,enabled) values ($1,$2,$3)
       on conflict (branch_id,module_key) do nothing`,
      [hqId, m.key, !!m.mvp],
    );
  }

  // CTO 마스터 (나한결). 없을 때만 생성.
  const exists = await db.query(`select 1 from person where login_id=$1`, ["나한결"]);
  if (exists.rows.length === 0) {
    await db.query(
      `insert into person(login_id,name,pin_hash,is_cto) values ($1,$2,$3,true)`,
      ["나한결", "나한결", hashPin("365785")],
    );
  }
}
