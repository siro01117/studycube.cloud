-- ================================================================
-- 스큐(SQ) 코어 스키마 — 사람중심 RBAC + 지점 + 모듈
-- Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 실행. 재실행 안전(초기화 후 생성).
-- 모델: person / role / permission / role_permission / person_role(+branch) / branch / module / branch_module
-- 원칙: 역할·권한은 데이터(행). 모듈 추가 = INSERT. 코드는 역할이름 X, 권한만 본다.
-- ================================================================

-- ---------------- 0. 초기화 ----------------
drop table if exists branch_module    cascade;
drop table if exists person_role      cascade;
drop table if exists role_permission  cascade;
drop table if exists permission       cascade;
drop table if exists role             cascade;
drop table if exists module           cascade;
drop table if exists person           cascade;
drop table if exists branch           cascade;
drop function if exists has_perm(uuid, text) cascade;
drop function if exists is_cto()             cascade;

create extension if not exists "uuid-ossp";

-- ---------------- 1. branch (지점, 본점도 한 행 is_hq) ----------------
create table branch (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  code        text unique,
  is_hq       boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------- 2. person (사람=계정, auth.users 1:1) ----------------
create table person (
  id          uuid primary key references auth.users(id) on delete cascade,
  login_id    text unique not null,          -- 로그인 아이디(소문자 정규화 저장)
  auth_email  text unique not null,          -- 내부 합성 이메일(ascii). 로그인 시 login_id→여기→Auth
  name        text not null,
  phone       text,
  status      text not null default 'active', -- active | inactive
  attributes  jsonb not null default '{}',    -- 나중 귀속 정보(학년·학교 등)
  created_at  timestamptz not null default now(),
  created_by  uuid references person(id) on delete set null
);

-- ---------------- 3. role (역할 — 데이터) ----------------
create table role (
  id     uuid primary key default uuid_generate_v4(),
  key    text unique not null,    -- cto, wonjang, siljang, ...
  label  text not null,
  rank   int  not null default 0, -- 발급/관리 위계 기준
  color  text
);

-- ---------------- 4. permission (권한 — 데이터, 모듈이 추가) ----------------
create table permission (
  key    text primary key,        -- account.provision, attendance.edit, ...
  label  text not null
);

-- ---------------- 5. role_permission (역할 = 권한 묶음) ----------------
create table role_permission (
  role_id        uuid references role(id) on delete cascade,
  permission_key text references permission(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ---------------- 6. person_role (누가·어느지점·무슨역할 = 다대다, 지점별) ----------------
create table person_role (
  id         uuid primary key default uuid_generate_v4(),
  person_id  uuid not null references person(id) on delete cascade,
  branch_id  uuid not null references branch(id) on delete cascade,
  role_id    uuid not null references role(id)   on delete cascade,
  unique (person_id, branch_id, role_id)
);

-- ---------------- 7. module (모듈 카탈로그) ----------------
create table module (
  key      text primary key,       -- seat, attendance, lunch, ...
  label    text not null,
  icon     text,
  requires text[] not null default '{}',  -- 필요 권한(이거 없으면 카드 숨김)
  ord      int not null default 99
);

-- ---------------- 8. branch_module (지점별 모듈 on/off — 본점 할당) ----------------
create table branch_module (
  branch_id  uuid references branch(id) on delete cascade,
  module_key text references module(key) on delete cascade,
  enabled    boolean not null default true,
  primary key (branch_id, module_key)
);

-- ================================================================
-- 헬퍼 함수
-- ================================================================
-- 현재 유저가 CTO 역할? (전 지점·전권) — has_perm 이 참조하므로 먼저 정의
create function is_cto()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from person_role pr join role r on r.id = pr.role_id
    where pr.person_id = auth.uid() and r.key = 'cto'
  )
$$;

-- 이 지점에서 이 권한 보유? (소속+역할+권한 한방). CTO는 항상 통과.
create function has_perm(p_branch uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_cto() or exists (
    select 1
    from person_role pr
    join role_permission rp on rp.role_id = pr.role_id
    where pr.person_id = auth.uid()
      and pr.branch_id = p_branch
      and rp.permission_key = p_perm
  )
$$;

-- ================================================================
-- RLS — 코어(최소 안전판). 권한 필요한 쓰기는 서버액션(service_role)이 앱에서 검증 후 수행.
-- ================================================================
alter table branch          enable row level security;
alter table person          enable row level security;
alter table role            enable row level security;
alter table permission      enable row level security;
alter table role_permission enable row level security;
alter table person_role     enable row level security;
alter table module          enable row level security;
alter table branch_module   enable row level security;

-- 카탈로그(역할·권한·매핑·모듈): 로그인 유저 읽기 허용 (UI 렌더용)
create policy "role read"            on role            for select to authenticated using (true);
create policy "permission read"      on permission      for select to authenticated using (true);
create policy "role_permission read" on role_permission for select to authenticated using (true);
create policy "module read"          on module          for select to authenticated using (true);

-- branch: 내가 소속된 지점 또는 CTO
create policy "branch read" on branch for select to authenticated
  using ( is_cto() or exists (select 1 from person_role pr where pr.person_id=auth.uid() and pr.branch_id=branch.id) );

-- branch_module: 내 소속 지점 것 또는 CTO
create policy "branch_module read" on branch_module for select to authenticated
  using ( is_cto() or exists (select 1 from person_role pr where pr.person_id=auth.uid() and pr.branch_id=branch_module.branch_id) );

-- person: 본인 또는 CTO (그 외 조회는 서버액션 경유)
create policy "person read self/cto" on person for select to authenticated
  using ( id = auth.uid() or is_cto() );
create policy "person update self"   on person for update to authenticated
  using ( id = auth.uid() );

-- person_role: 본인 또는 CTO
create policy "person_role read" on person_role for select to authenticated
  using ( person_id = auth.uid() or is_cto() );

-- ================================================================
-- 시드 — 지점(본점) · 역할 · 권한 · 역할권한
-- ================================================================
-- 본점
insert into branch (id, name, code, is_hq) values
  ('00000000-0000-0000-0000-000000000001', '본점', 'HQ', true)
on conflict do nothing;

-- 역할 (rank ↑ = 상위)
insert into role (key, label, rank, color) values
  ('cto',               'CTO',     100, '#5b8def'),
  ('wonjang',           '원장',     95, '#5b8def'),
  ('siljang',           '실장',     70, '#8a93a6'),
  ('senior_instructor', '선임강사',  70, '#8a93a6'),
  ('manager',           '관리자',    40, '#8a93a6'),
  ('mentor',            '멘토',      40, '#8a93a6'),
  ('instructor',        '강사',      40, '#8a93a6'),
  ('student',           '학생',      10, '#6b7180')
on conflict (key) do nothing;

-- 권한 (모듈이 늘려감. 코어 + 1차 모듈 후보)
insert into permission (key, label) values
  ('hq.cross_branch',       '전 지점 가로질러 보기'),
  ('branch.create',         '지점 생성'),
  ('module.assign',         '지점 모듈 할당'),
  ('branch.settings',       '지점 설정·통계'),
  ('account.provision',     '계정 발급'),
  ('role.assign',           '역할 부여'),
  ('student.view',          '학생 조회'),
  ('student.edit',          '학생 정보 수정'),
  ('student.assign_mentor', '멘토 배정'),
  ('attendance.view',       '출결 조회'),
  ('attendance.edit',       '출결 관리'),
  ('class.manage',          '수업 관리'),
  ('content.author',        '콘텐츠 작성'),
  ('mentoring.log',         '멘토링 기록'),
  ('billing.view',          '결제 조회'),
  ('billing.manage',        '결제 관리'),
  ('self.use',              '본인 모듈 이용')
on conflict (key) do nothing;

-- 역할→권한 매핑
-- 원장 = hq 전용 3개 제외한 전 권한 / 그 아래는 매트릭스 기본값. (CTO는 함수로 전권 → 매핑 불필요하지만 명시 위해 self.use만)
do $$
declare r_wonjang uuid; r_siljang uuid; r_senior uuid; r_manager uuid; r_mentor uuid; r_instr uuid; r_student uuid; r_cto uuid;
begin
  select id into r_cto     from role where key='cto';
  select id into r_wonjang from role where key='wonjang';
  select id into r_siljang from role where key='siljang';
  select id into r_senior  from role where key='senior_instructor';
  select id into r_manager from role where key='manager';
  select id into r_mentor  from role where key='mentor';
  select id into r_instr   from role where key='instructor';
  select id into r_student from role where key='student';

  -- CTO: 명시적으로도 전권(함수가 우선이지만 매핑도 채워둠)
  insert into role_permission select r_cto, key from permission on conflict do nothing;

  -- 원장: hq.* 제외 전권
  insert into role_permission
    select r_wonjang, key from permission
    where key not in ('hq.cross_branch','branch.create','module.assign')
    on conflict do nothing;

  -- 실장(행정 총괄)
  insert into role_permission values
    (r_siljang,'branch.settings'),(r_siljang,'account.provision'),(r_siljang,'role.assign'),
    (r_siljang,'student.view'),(r_siljang,'student.edit'),(r_siljang,'student.assign_mentor'),
    (r_siljang,'attendance.view'),(r_siljang,'attendance.edit'),
    (r_siljang,'billing.view'),(r_siljang,'self.use') on conflict do nothing;

  -- 선임강사(교육 총괄)
  insert into role_permission values
    (r_senior,'student.view'),(r_senior,'attendance.view'),(r_senior,'attendance.edit'),
    (r_senior,'class.manage'),(r_senior,'content.author'),(r_senior,'mentoring.log'),(r_senior,'self.use')
    on conflict do nothing;

  -- 관리자(행정)
  insert into role_permission values
    (r_manager,'student.view'),(r_manager,'student.edit'),
    (r_manager,'attendance.view'),(r_manager,'attendance.edit'),
    (r_manager,'billing.view'),(r_manager,'self.use') on conflict do nothing;

  -- 멘토
  insert into role_permission values
    (r_mentor,'student.view'),(r_mentor,'mentoring.log'),(r_mentor,'self.use') on conflict do nothing;

  -- 강사
  insert into role_permission values
    (r_instr,'student.view'),(r_instr,'attendance.view'),(r_instr,'attendance.edit'),
    (r_instr,'class.manage'),(r_instr,'content.author'),(r_instr,'self.use') on conflict do nothing;

  -- 학생
  insert into role_permission values (r_student,'self.use') on conflict do nothing;
end $$;

-- ================================================================
-- 완료. 모듈(module/branch_module)은 모듈 추가할 때 INSERT.
-- 마스터 CTO 계정은 `node scripts/bootstrap.mjs` 로 생성.
-- ================================================================
