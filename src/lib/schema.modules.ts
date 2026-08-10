// 모듈 테이블 스키마 (A 레포 supabase/*.sql 에서 이식). 멱등 — bootstrap 이 CORE_SQL 뒤에 exec.
// PGlite = Postgres 라 A 의 DDL 이 거의 그대로. 단 RLS 는 없음(로컬) → 접근제어는 앱단 can()/guard 로.
// 모듈 하나씩 이식할 때마다 이 파일에 섹션 추가.

export const MODULE_SQL = `
-- ================= 학생 (모든 학습 모듈의 뿌리) =================
create table if not exists student(
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branch(id) on delete cascade,
  name           text not null,
  level          text,                              -- middle | high | adult
  grade          text,                              -- 학년(중1..고3) 또는 null
  school         text,
  is_repeat      boolean not null default false,    -- 성인=N수생
  status         text not null default 'enrolled',  -- enrolled | leave (퇴원 폐지)
  guardian_phone text,
  student_phone  text,
  birthdate      date,
  gender         text,                              -- male | female
  enrolled_at    date,
  created_at     timestamptz not null default now(),
  created_by     uuid references person(id) on delete set null
);
create index if not exists idx_student_branch on student(branch_id);
create index if not exists idx_student_status on student(branch_id, status);

-- ================= 좌석 배치도 (방 도면 + 좌석) =================
create table if not exists room(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  floor      int  not null default 4,      -- 층 (예: 4, 5)
  name       text not null,
  pos_x      int  not null default 0,      -- 층 도면에서 방 위치(미사용시 0)
  pos_y      int  not null default 0,
  cols       int  not null default 8,      -- 방 그리드 크기
  rows       int  not null default 6,
  created_at timestamptz not null default now()
);
create index if not exists idx_room_branch on room(branch_id);
alter table room add column if not exists door_side text;  -- 입구(문) 위치: top | bottom | left | right

create table if not exists seat(
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references branch(id) on delete cascade,
  room_id            uuid references room(id) on delete set null,
  zone               text,
  label              text not null,
  grid_x             int,                  -- 도면 픽셀 좌표(드래그 배치)
  grid_y             int,
  number             int,                  -- 자동 부여(수정 가능)
  facing             text,                 -- up | down | left | right
  seat_type          text,
  pos_x              int not null default 0,   -- 레거시 좌표(미사용)
  pos_y              int not null default 0,
  status             text not null default 'empty',   -- empty | occupied | maintenance
  current_student_id uuid references student(id) on delete set null,
  assigned_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_seat_branch on seat(branch_id);
create index if not exists idx_seat_room on seat(room_id);

-- ================= 출결 (등하원) — 학생 1명 × 하루 1행 =================
create table if not exists attendance(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  student_id   uuid not null references student(id) on delete cascade,
  date         date not null,
  status       text not null default 'present',   -- present | late | absent | left_early
  check_in_at  timestamptz,
  check_out_at timestamptz,
  reason       text,
  created_by   uuid references person(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(student_id, date)
);
create index if not exists idx_attendance_bd on attendance(branch_id, date);

-- ================= 입·퇴실 이벤트 로그 (불변 기록, 하루 여러 번 가능) =================
create table if not exists attendance_event(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  kind       text not null,                  -- in | out
  auto       boolean not null default false, -- 자동 처리(마감 자동 퇴실 등) 여부
  at         timestamptz not null default now(),
  date       date not null,
  created_by uuid references person(id) on delete set null
);
create index if not exists idx_att_event_sd on attendance_event(student_id, date);
create index if not exists idx_att_event_bd on attendance_event(branch_id, date);

-- ================= 순찰 이벤트 로그 (불변 기록) — 순찰 중 좌석 원탭 상태 =================
-- state = 프리셋 키(seated|away|academy|counsel|sleep|distract). points = 그 상태 벌점(프리셋 스냅샷).
create table if not exists patrol_event(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  state      text not null,
  points     int  not null default 0,
  source     text not null default 'patrol',   -- patrol | manual (수동 벌점 대비)
  note       text,
  at         timestamptz not null default now(),
  date       date not null,
  created_by uuid references person(id) on delete set null
);
create index if not exists idx_patrol_sd on patrol_event(student_id, date);
create index if not exists idx_patrol_bd on patrol_event(branch_id, date);
-- 순찰 세션: 한 번의 순찰(토글 ON~OFF) 안에서는 학생당 상태 1개 → 재탭하면 교체
alter table patrol_event add column if not exists session_id uuid;
-- 기록 당시 좌석 스냅샷 → 이력 재현 시 "그때 그 자리"에 표시(학생이 자리 옮겨도 충실)
alter table patrol_event add column if not exists seat_id uuid;

-- ================= 순찰 세션 (한 번의 순찰 = 시작~종료 시각 기록) =================
-- id 는 클라가 생성해 patrol_event.session_id 와 매칭. "언제 순찰했나" 이력용.
create table if not exists patrol_session(
  id         uuid primary key,
  branch_id  uuid not null references branch(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  date       date not null,
  created_by uuid references person(id) on delete set null
);
create index if not exists idx_patrol_session_bd on patrol_session(branch_id, started_at);

-- ================= 벌점 이벤트 (수동 부여, append-only) =================
-- 순찰 벌점(patrol_event.points)과 합산해 "이번 주 누적" 산출. reason=프리셋 키, points=부여(정정=음수).
create table if not exists penalty_event(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  reason     text not null,
  points     int  not null,
  note       text,
  at         timestamptz not null default now(),
  date       date not null,
  created_by uuid references person(id) on delete set null
);
create index if not exists idx_penalty_sd on penalty_event(student_id, date);
create index if not exists idx_penalty_bd on penalty_event(branch_id, date);

-- ================= 학생 스케쥴러 (원 운영 시간표 + 학생별 정기·예외 일정) =================
-- 원 운영 시간표(교시) — 지점 단위. 학생 화면의 배경 음영 + 자습 일괄생성의 소스.
create table if not exists schedule_period(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  label      text not null,
  start_min  int  not null,
  end_min    int  not null,
  ord        int  not null default 0,
  check (start_min >= 0 and end_min > start_min)
);
create index if not exists idx_schedule_period_branch on schedule_period(branch_id);

-- 학생별 정기(매주 반복) 규칙. days=CSV "1,3,5"(1=월..7=일). 자정 넘김은 end_min>=1440(예: 1500=익일 01:00).
create table if not exists schedule_rule(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  reason     text not null,
  kind       text not null check (kind in ('study','academy','counsel','absent')),
  title      text not null default '',
  start_min  int  not null,
  end_min    int  not null,
  days       text not null default '',
  created_at timestamptz not null default now(),
  check (start_min >= 0 and end_min > start_min)
);
create index if not exists idx_schedule_rule_bs on schedule_rule(branch_id, student_id);

-- 예외(1회성). skip_rule_id 가 있으면 그 날만 해당 정기 규칙을 대체.
create table if not exists schedule_exception(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  student_id   uuid not null references student(id) on delete cascade,
  reason       text not null,
  kind         text not null check (kind in ('study','academy','counsel','absent')),
  title        text not null default '',
  start_min    int  not null,
  end_min      int  not null,
  date         date not null,
  skip_rule_id uuid references schedule_rule(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (start_min >= 0 and end_min > start_min)
);
create index if not exists idx_schedule_exception_bs on schedule_exception(branch_id, student_id);
create index if not exists idx_schedule_exception_bd on schedule_exception(branch_id, date);

-- 학생×요일 등원/하원 시각(자습 블록 폐지, 등하원만 저장). 자습은 "다른 일정이 없고 등원~하원 사이"로 파생 판정(src/lib/schedule.ts statusAt).
-- 자정 넘김은 leave_min>1440 으로 저장(예: 익일 00:30 = 1470).
create table if not exists schedule_hours(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  day        int  not null check (day between 1 and 7),
  arrive_min int  not null,
  leave_min  int  not null,
  created_at timestamptz not null default now(),
  check (leave_min > arrive_min),
  unique(student_id, day)
);
create index if not exists idx_schedule_hours_bs on schedule_hours(branch_id, student_id);
`;
