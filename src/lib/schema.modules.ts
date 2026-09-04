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
-- 공개 폼(studycube.co.kr) 학생 로그인용 전용 코드(이름+코드). 지점 내 유일.
alter table student add column if not exists access_code text;
create unique index if not exists uq_student_access_code on student(branch_id, access_code) where access_code is not null;

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
alter table attendance_event add column if not exists note text;

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

-- ================= 신청·설문 접수 (공개 폼 studycube.co.kr → 여기로 적재) =================
-- 도시락·컨텐츠·상담·스케쥴 등 모든 유형을 한 테이블로. payload=폼 답변(jsonb, 유형별 자유).
-- 관리쪽(studycube.cloud)에서 type 으로 필터해 인사이트·처리.
create table if not exists submission(
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branch(id) on delete cascade,
  type           text not null,                       -- lunch | content | counsel | schedule
  student_id     uuid references student(id) on delete set null,  -- 매칭되면 연결
  submitter_name  text,
  submitter_phone text,
  payload        jsonb not null default '{}',
  status         text not null default 'pending',     -- pending | done | rejected
  note           text,
  created_at     timestamptz not null default now(),
  processed_by   uuid references person(id) on delete set null,
  processed_at   timestamptz
);
create index if not exists idx_submission_btc on submission(branch_id, type, created_at);
create index if not exists idx_submission_student on submission(student_id);
-- 재제출 시 created_at 을 now() 로 덮어써 "마지막 제출"로 쓰기 때문에(actions.ts submitForm), 최초
-- 제출 시각은 따로 보존해야 한다 — 스케쥴 입력 기간(schedule_window/schedule_grant) 판정의
-- "첫 제출 시각으로부터 24시간" 기준이 여기서 나온다(src/lib/schedule-window.ts). insert 시 1회만
-- 채우고 update 에서는 절대 건드리지 않는다.
alter table submission add column if not exists first_submitted_at timestamptz;

-- 제출 동시성 구멍(2026-08-31, P1): actions.ts submitForm 이 select-then-insert 라 같은 학생이
-- 두 탭/기기로 거의 동시에 제출하면 중복 행이 생겼다(유니크 제약이 없어 막히지 않았음). 키는
-- (branch_id, student_id, type, payload->>'_slug') — resolveEditState(schedule-window-server.ts)가
-- "제출 감지는 type"만 보는 것과 별개로, "덮어쓰기 대상 조회"는 이 프로젝트에서 의도적으로 slug 까지
-- 본다(같은 type 의 폼이 여럿일 수 있어서, actions.ts 기존 select 문 그대로). 현재 FORMS(registry.ts)
-- 중 이 경로(f/actions.ts submitForm, requiresStudent && !multiple)를 타는 타입은 schedule·survey
-- 뿐이고 둘 다 슬러그가 하나씩이라 "학생당 1행"이 항상 맞다 — multiple:true 인 타입은 없어 제외할
-- 대상이 없었다(도시락 lunch 는 이 테이블이 아니라 lunch_order 로, 일정변경 schedule_change 는
-- schedule_request 로 별도 저장되어 애초에 이 경로를 안 탄다).
-- 인덱스를 걸기 전에 기존 중복부터 정리한다: 그룹마다 가장 최근 행만 남기고, 최초 제출 시각
-- (first_submitted_at, 입력기간 판정의 기준)은 잃지 않도록 그룹의 최솟값을 남는 행에 합친 뒤 나머지를
-- 지운다. 유니크 인덱스가 서는 순간부터 insert 는 on conflict do update 로 바뀌어 새 중복이 생길 수
-- 없으므로, 이 정리 문장은 자연히 멱등(중복이 없으면 아무 것도 하지 않는다) — 날짜 스코프 불필요.
with dup as (
  select id,
         row_number() over (
           partition by branch_id, student_id, type, (payload->>'_slug')
           order by created_at desc, id desc
         ) as rn,
         min(first_submitted_at) over (
           partition by branch_id, student_id, type, (payload->>'_slug')
         ) as min_first
  from submission
  where student_id is not null
)
update submission s set first_submitted_at = d.min_first
  from dup d
 where s.id = d.id and d.rn = 1 and s.first_submitted_at is distinct from d.min_first;

with dup as (
  select id,
         row_number() over (
           partition by branch_id, student_id, type, (payload->>'_slug')
           order by created_at desc, id desc
         ) as rn
  from submission
  where student_id is not null
)
delete from submission s using dup d where s.id = d.id and d.rn > 1;

create unique index if not exists uq_submission_student_type_slug
  on submission(branch_id, student_id, type, (payload->>'_slug'))
  where student_id is not null;

-- 공개 폼 본인확인(이름+access_code) 무차별 대입 방어: (지점,이름)별 실패 카운트·잠금.
-- 서버리스라 인메모리 불가 → DB에 둔다. 성공 시 행 삭제, 실패 누적 시 일시 잠금.
create table if not exists access_attempt(
  branch_id    uuid not null references branch(id) on delete cascade,
  name         text not null,
  fails        int  not null default 0,
  first_fail   timestamptz not null default now(),
  locked_until timestamptz,
  primary key(branch_id, name)
);

-- ================= 도시락 (월 단위 선신청제) — 기존 도시락앱 체계 이식 =================
-- 월별 설정(중/석식 라벨·가격·공지) + 휴무일 + 학생 주문(끼니 날짜들) + 선불 결제.
create table if not exists lunch_month(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  year         int  not null,
  month        int  not null check (month between 1 and 12),
  lunch_label  text not null default '중식',
  lunch_price  int  not null default 0,
  dinner_label text not null default '석식',
  dinner_price int  not null default 0,
  notice       text,
  created_at   timestamptz not null default now(),
  unique(branch_id, year, month)
);

-- 휴무일: 그날 중/석식 신청 차단(공휴일은 코드 상수로 자동, 이건 수동 지정분).
create table if not exists lunch_closure(
  month_id     uuid not null references lunch_month(id) on delete cascade,
  date         date not null,
  lunch_closed  boolean not null default true,
  dinner_closed boolean not null default true,
  label        text,
  primary key(month_id, date)
);

-- 학생 주문(월×학생 1행) — 선불 결제 추적 포함.
create table if not exists lunch_order(
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branch(id) on delete cascade,
  month_id    uuid not null references lunch_month(id) on delete cascade,
  student_id  uuid not null references student(id) on delete cascade,
  paid        boolean not null default false,
  paid_amount int not null default 0,
  paid_date   date,
  memo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(month_id, student_id)
);
create index if not exists idx_lunch_order_month on lunch_order(month_id);
-- 도시락 신청은 학생 전용이다(lunch-actions.ts 가 lunch_order 를 만드는 유일한 경로) — 관리자는
-- 등록·삭제를 못 하고 결제 정보만 고친다. 그래서 신청 출처를 구분할 필요가 없다(구 source 컬럼은
-- bootstrap.ts 의 마이그레이션으로 떨어뜨린다).

-- 주문한 끼니(날짜×중/석식). 발주 집계는 여기서.
create table if not exists lunch_meal(
  order_id   uuid not null references lunch_order(id) on delete cascade,
  date       date not null,
  meal_type  text not null check (meal_type in ('lunch','dinner')),
  price      int  not null default 0, -- 신청 시점 단가 스냅샷(월 가격이 나중에 바뀌어도 안 흔들림)
  primary key(order_id, date, meal_type)
);
create index if not exists idx_lunch_meal_date on lunch_meal(date);

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

-- ================= 학생 스케쥴 입력 기간 =================
-- (2026-08-22 폐지) 지점 전체 입력 기간(schedule_window)·기간제 개별 개방은 "한 번도 제출한 적 없으면
-- 언제나 열림 / 제출하는 순간 잠김 / 관리자가 활성화하면 1회용으로 다시 열림"으로 완전히 교체됐다.
-- schedule_window 테이블은 더 이상 코드에서 참조하지 않는다 — 운영 데이터를 보존하려고(되돌릴 여지를
-- 남기려고) drop 하지 않고 테이블만 남겨둔다. 새로 생기는 행도 없다.
create table if not exists schedule_window(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  label      text,
  opens_at   timestamptz not null,
  closes_at  timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references person(id) on delete set null,
  check (closes_at > opens_at)
);
create index if not exists idx_schedule_window_bo on schedule_window(branch_id, opens_at);

-- 관리자가 학생을 골라 1회용으로 여는 개별 활성화(2026-08-22, 기간제 폐지). opens_at/closes_at 은
-- NOT NULL·check 제약 때문에 남겨두되 판정에 쓰지 않는다(activateStudents 가 now()~+100년으로 채움).
-- consumed_at 이 null 이면 아직 유효(=열려 있음), 학생이 제출하면 그 순간 now() 로 채워 소진된다
-- (f/actions.ts submitForm). label/note/created_by/created_at 은 그대로 활용(관리 화면 표시용).
create table if not exists schedule_grant(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  student_id   uuid not null references student(id) on delete cascade,
  opens_at     timestamptz not null,
  closes_at    timestamptz not null,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references person(id) on delete set null,
  check (closes_at > opens_at)
);
create index if not exists idx_schedule_grant_bs on schedule_grant(branch_id, student_id);
-- 입력 기간(전체) + 개별 개방을 관리 화면에서 하나의 폼(대상: 전체/특정 학생)으로 합치면서(2026-08-22)
-- 라벨(이름)을 두 종류 모두 공통 입력으로 받는다 — schedule_window 는 이미 label 이 있었고, grant 에는
-- 없었으므로 추가한다. 기존 행은 label=null(화면에서는 "(라벨 없음)"으로 표시, schedule_window 와 동일).
alter table schedule_grant add column if not exists label text;
-- 1회용 활성화(2026-08-22): 학생이 제출하면 소진되는 시각. null=아직 유효(열려 있음).
alter table schedule_grant add column if not exists consumed_at timestamptz;
-- 기간제였던 기존 행(과거 opens_at/closes_at 기준)은 새 규칙에서 아무 의미가 없다 — 유니크 인덱스를
-- 만들기 전에 무효화(소진 처리)한다.
-- 반드시 cutover 시점 이전에 만들어진 행만 건드린다: 이 블록은 SCHEMA_VERSION 이 바뀔 때마다 다시
-- 도는 자리라, 조건 없이 쓰면 앞으로 스키마를 올릴 때마다 그때 살아있던 활성화가 전부 취소된다.
update schedule_grant set consumed_at = now()
 where consumed_at is null and created_at < timestamptz '2026-08-22 00:00+09';
-- 학생당 "아직 소진되지 않은" 활성화는 최대 1개만 — 활성화 insert 를 on conflict do nothing 으로
-- 멱등하게 만들고(이미 열려 있는 학생을 다시 활성화해도 중복행이 안 생긴다), 판정 쿼리도 항상
-- 최대 1행만 보면 되게 한다.
create unique index if not exists uq_schedule_grant_active on schedule_grant(branch_id, student_id) where consumed_at is null;

-- ================= 학생 일회성 일정 변경 신청 (관리자 승인 필요) =================
-- 정기 스케쥴(schedule_rule/schedule_hours)과 별개로 "이 날만" 바뀌는 요청. 입력 기간과 무관하게
-- 언제나 신청 가능(신청일 뿐 정기 수정이 아니다). 승인되면 schedule_exception 을 만들어 exception_id
-- 로 연결한다. skip_rule_id 는 스키마 설계서에는 없던 컬럼이지만, "대체"로 낸 신청(겹치는 정기 규칙을
-- 그 날만 건너뜀)을 승인 시점까지 기억해둘 곳이 필요해 schedule_exception 과 같은 패턴으로 추가했다
-- (신청 시점에 학생이 고른 값을 그대로 승인 시 schedule_exception.skip_rule_id 에 옮겨 담는다).
create table if not exists schedule_request(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  student_id   uuid not null references student(id) on delete cascade,
  date         date not null,
  kind         text not null check (kind in ('study','academy','counsel','absent')),
  reason       text not null,
  title        text,
  start_min    int  not null,
  end_min      int  not null,
  skip_rule_id uuid references schedule_rule(id) on delete set null,
  status       text not null default 'pending',    -- pending | approved | rejected
  note         text,
  exception_id uuid references schedule_exception(id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references person(id) on delete set null,
  check (end_min > start_min)
);
create index if not exists idx_schedule_request_bsd on schedule_request(branch_id, status, date);
create index if not exists idx_schedule_request_sd on schedule_request(student_id, date);
-- 신청 유형(absent|late|early|out|custom) — src/lib/schedule.ts REQUEST_TYPES 가 단일 출처.
-- start_min/end_min 은 이미 그 유형에 맞게 환산된 값(schedule-request-actions.ts resolveRequestRange)이고,
-- req_type 은 표시(칩·시간 라벨 읽기 방식)에만 쓰인다 — schedule_exception 승인 로직은 지금처럼 start/end/kind/reason 만 본다.
alter table schedule_request add column if not exists req_type text not null default 'custom';
-- 변경 신청 동시성 구멍(2026-08-31, P3): createTempRequests 의 중복 검사가 select 라 같은
-- (날짜,시작,종료) 를 두 탭에서 거의 동시에 넣으면 중복 행이 생길 수 있었다. 하루에 여러 건 신청은
-- 정상(시간대가 다르면 됨)이라 유니크 키에서 날짜만으로 막으면 안 되고, 완전히 같은 (날짜,시작,종료)
-- 조합만 막아야 한다 — 그리고 반려/취소된 신청은 다시 그 시간대로 신청할 수 있어야 하므로
-- status 가 pending|approved 인 행끼리만 유니크(부분 인덱스). 새로 insert 되는 행은 항상
-- status 기본값 'pending' 이라 on conflict 추론 조건과 항상 일치한다.
-- 인덱스 걸기 전 기존 중복 정리(있었다면). approved 를 pending 보다 우선해서 남기고(더 확정적인
-- 상태), 동률이면 최신을 남긴다. 중복이 없으면 아무 것도 안 지우므로 멱등.
with dup as (
  select id,
         row_number() over (
           partition by branch_id, student_id, date, start_min, end_min
           order by (status = 'approved') desc, created_at desc, id desc
         ) as rn
  from schedule_request
  where status in ('pending','approved')
)
delete from schedule_request s using dup d where s.id = d.id and d.rn > 1;

create unique index if not exists uq_schedule_request_active_dedup
  on schedule_request(branch_id, student_id, date, start_min, end_min)
  where status in ('pending','approved');

-- 신청 갈래(temp|rule_edit|rule_delete) — src/lib/schedule.ts REQUEST_KINDS 가 단일 출처.
-- temp(기존): 특정 날짜 하루만 바뀌는 신청. 기존 컬럼(date/kind/reason/title/start_min/end_min) 그대로 쓰고
-- target_rule_id/days 는 null.
-- rule_edit: 기존 정기 규칙(target_rule_id) 하나의 요일/시간/사유/제목을 바꾸는 신청. "새 값"을 기존 컬럼
-- (kind/reason/title/start_min/end_min)에 재사용하고, 요일은 days(schedule_rule.days 와 같은 CSV 형식)에 담는다.
-- date 는 특정 날짜가 없으므로 null.
-- rule_delete: 기존 정기 규칙(target_rule_id) 하나를 영구 삭제하는 신청. kind/reason/title/start_min/end_min/
-- days 는 신청 시점의 "현재 값" 스냅샷(표시용 — 승인 뒤 규칙이 지워져도 무엇을 지웠는지 보여줄 수 있게).
-- date 는 null.
-- target_rule_id 는 "on delete set null"(cascade 아님) — 그 규칙이 다른 경로로 지워져도 이 신청 행 자체는
-- 남아 있어야 승인 시점에 "대상이 사라졌다"고 판단해 반려 사유를 남길 수 있고(schedule-request.ts),
-- rule_delete 승인 자체가 그 규칙을 지울 때도(같은 트랜잭션 안) 방금 승인 처리한 이 행이 cascade 로
-- 함께 지워지는 걸 막아 prev_snapshot(되돌리기용)이 살아남는다.
alter table schedule_request add column if not exists req_kind text not null default 'temp';
alter table schedule_request add column if not exists target_rule_id uuid references schedule_rule(id) on delete set null;
alter table schedule_request add column if not exists days text;
alter table schedule_request alter column date drop not null;
-- 승인 시점의 이전 값 스냅샷(되돌리기용, jsonb). rule_edit=수정 전 규칙 전체 행, rule_delete=삭제 전 규칙
-- 전체 행({id,reason,kind,title,start_min,end_min,days}) — 되돌릴 때 rule_delete 는 이 스냅샷으로
-- (가능하면 같은 id로) schedule_rule 행을 재생성한다. temp 는 지금처럼 exception_id 를 지우는 것만으로
-- 충분해 prev_snapshot 을 쓰지 않는다.
alter table schedule_request add column if not exists prev_snapshot jsonb;

-- ================= 지점별 설정 (키-값) =================
-- 예: schedule_auto_approve='1' → 변경 신청을 접수 즉시 자동 승인.
create table if not exists branch_setting(
  branch_id  uuid not null references branch(id) on delete cascade,
  key        text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key(branch_id, key)
);

-- ================= 공지 (직원 모듈 1번째: 공지 → 근무·교실 일정 → QR 출근 → 급여) =================
-- 다른 모듈은 "정정 = 삭제" 원칙이지만 공지는 오탈자 정정이 흔해 수정을 허용한다(updated_at 로 "수정됨" 표시).
-- audience: 'staff'(기존 직원 공지, 기본값 — 기존 행·기존 화면 그대로 동작) | 'student'(학생용, 공개 폼
-- 허브에서 노출). 같은 테이블에 얹은 이유: 작성/수정/삭제/중요 표시 등 관리 로직이 완전히 같고, 다른 건
-- "누구에게 보이는지"와 "읽음을 누구 기준으로 세는지"뿐이라 테이블을 가르면 그 로직을 통째로 복붙하게 된다.
create table if not exists notice(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  author_id  uuid references person(id) on delete set null,
  title      text not null,
  body       text not null,
  important  boolean not null default false,
  audience   text not null default 'staff' check (audience in ('staff','student')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notice_branch on notice(branch_id, created_at desc);

-- 공지(직원용) × 사람 읽음. 같은 사람이 여러 번 열어도 한 행(최초 읽은 시각 고정) — 원자적 upsert(on conflict do nothing).
-- person 기준이라 학생에는 못 쓴다(학생은 person 행이 없다) — 학생 읽음은 아래 notice_student_read 로 별도.
create table if not exists notice_read(
  notice_id  uuid not null references notice(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key(notice_id, person_id)
);

-- 공지(학생용) × 학생 읽음. notice_read 와 같은 원자적 upsert 원칙이되 person 대신 student 를 참조.
create table if not exists notice_student_read(
  notice_id  uuid not null references notice(id) on delete cascade,
  student_id uuid not null references student(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key(notice_id, student_id)
);

-- 공지 사진(notice_image) — 새 스토리지 자격증명 없이 dev(PGlite)·배포(Supabase) 양쪽에서 그대로
-- 돌아야 하므로 Supabase Storage 대신 바이너리를 DB(bytea)에 직접 담는다(집주인 확정). 공지 하나에
-- 여러 장 + 순서가 필요해 notice 에 컬럼으로 얹지 않고 1:N 별도 테이블로 뺀다. 공지가 지워지면 사진도
-- 함께 지워져야 하므로 on delete cascade. 업로드 전 브라우저가 이미 축소·재인코딩하지만(긴 변 1600px,
-- 장당 500KB 목표 — src/lib/notice-image.ts) 서버도 다시 검증한다: content_type 화이트리스트(jpeg·webp
-- 만, svg는 스크립트가 실행될 수 있어 애초에 제외) + byte_size 상한(600KB — 클라 목표 500KB에 인코더
-- 오차분 여유를 더한 값). 목록 조회에서 이 바이너리를 같이 실어 보내지 않는다 — id만 내려주고
-- 실제 표시는 캐시 가능한 별도 라우트(/api/notice-image/[id])가 맡는다(N+1도, 대용량 페이로드도 피함).
create table if not exists notice_image(
  id           uuid primary key default gen_random_uuid(),
  notice_id    uuid not null references notice(id) on delete cascade,
  position     int  not null default 0,               -- 표시 순서(0부터) — 여러 장일 때 스와이프 순서
  content_type text not null check (content_type in ('image/jpeg','image/webp')),
  byte_size    int  not null check (byte_size > 0 and byte_size <= 614400),
  data         bytea not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_notice_image_notice on notice_image(notice_id, position);

-- ================= 직원 근무·수업 일정 (직원 모듈 2번째: 공지 → 근무·교실 일정 → QR 출근 → 급여) =================
-- 공간은 새 테이블을 만들지 않고 기존 room 을 그대로 쓴다(자습실이 곧 수업·상담 공간 — 다용도).
-- capacity 는 강제 규칙이 아니라 "방 고를 때 보이는 정원 표시"용 — 4층 1:1 전용 방만 채워두고 나머지는
-- 비워둔다(null=표시 안 함). 겹침 자체는 room_id 기준 charging 검사(src/lib/staff-schedule.ts)가 막는다.
alter table room add column if not exists capacity int;

create table if not exists staff_schedule(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  date       date not null,
  start_min  int  not null,
  end_min    int  not null,
  kind       text not null check (kind in ('counter','class','counsel')), -- 카운터 근무 | 수업·과외 | 학부모 상담 — src/lib/staff-schedule.ts STAFF_SCHEDULE_KINDS 가 단일 출처
  room_id    uuid references room(id) on delete set null,                 -- 카운터 근무는 공간 없음(null). 수업·상담은 room 선택.
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references person(id) on delete set null,
  check (end_min > start_min)
);
create index if not exists idx_staff_schedule_bpd on staff_schedule(branch_id, person_id, date);
create index if not exists idx_staff_schedule_brd on staff_schedule(branch_id, room_id, date);

-- ================= 직원 근태 QR 출퇴근 (직원 모듈 3번째: 공지 → 근무·교실 일정 → QR 출근 → 급여) =================
-- 카운터 데스크톱에 띄우는 QR 이 담는 "짧은 수명 1회용 토큰"의 서버측 대장. 토큰 문자열 자체는
-- src/lib/staff-attendance.ts 가 이 행의 id 를 서명(HMAC, src/lib/auth.ts secret())해 만든다 —
-- 여기 저장하는 건 서명이 아니라 발급·만료·1회용 소진 상태(스캔 즉시 로그인 여부와 무관하게 소진
-- 처리 — 물리적 QR 한 장이 두 번 스캔되는 걸 막는 게 목적이고, 그 뒤 출퇴근 기록이 실제로 남는지는
-- 별개다: 로그인 전이면 continue 단계에서 서명된 쿠키로 이어간다).
create table if not exists staff_attendance_qr(
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branch(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,                 -- 스캔되어 소진된 시각(null=아직 미사용)
  used_by     uuid references person(id) on delete set null, -- 스캔 시점에 로그인돼 있었으면 그 사람, 아니면 null(로그인 전 스캔)
  used_ip     text                         -- 스캔 접속 IP — 나중에 IP 제한 근거로만 쓴다(지금은 기록만, 차단 없음)
);
create index if not exists idx_staff_attendance_qr_branch on staff_attendance_qr(branch_id, expires_at);

-- 출퇴근 기록 — 하루에 여러 건(정상 출근·정상 퇴근, 깜빡 잊고 다시 찍은 경우의 정정 등)이 쌓일 수
-- 있어 사람×날짜 한 행이 아니라 이벤트 한 건당 한 행으로 둔다(관리자가 "빠진 퇴근 기록만" 손으로
-- 추가하기도 쉽다). date 는 KST 날짜 키(src/lib/date.ts todayKey) — at 이 자정 근처라도 그날 근무로
-- 귀속시키려면 timestamptz 하나만으로는 애매해서 별도 컬럼으로 고정한다(도시락 lunch_month 와 같은 이유).
create table if not exists staff_attendance(
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branch(id) on delete cascade,
  person_id    uuid not null references person(id) on delete cascade,
  date         date not null,
  kind         text not null check (kind in ('in','out')),
  at           timestamptz not null,       -- 실제로 찍힌(또는 정정된) 시각
  source       text not null default 'qr' check (source in ('qr','manual')),
  ip           text,                       -- QR 스캔 접속 IP(수기 입력은 null)
  note         text,
  created_by   uuid references person(id) on delete set null, -- QR: 본인. 수기 추가: 정정한 관리자.
  corrected_by uuid references person(id) on delete set null, -- 손으로 고친 사람(처음부터 수기 추가면 null — created_by 가 이미 그 사람)
  corrected_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_staff_attendance_bpd on staff_attendance(branch_id, person_id, date);
create index if not exists idx_staff_attendance_bd on staff_attendance(branch_id, date);

-- ================= 재무제표(수입·지출 장부) =================
-- 손으로 기록하는 원장 한 줄 = 수입/지출 한 건. 분류는 자유 입력이 아니라 src/lib/finance.ts
-- FINANCE_CATEGORIES 가 유일한 출처(코드 상수) — 여기 check 제약이 그 목록과 정확히 같은 값만
-- 허용한다(둘이 어긋나면 부팅 즉시 insert 가 막히므로 목록을 바꿀 땐 항상 같이 바꿔야 한다).
--
-- "도시락" 분류는 의도적으로 없다: 도시락 결제(lunch_order.paid/paid_amount)가 이미 실제 입금
-- 기록이라 여기 또 손으로 적으면 이중계상이 된다. 화면은 그 달 lunch_order 를 직접 합산해
-- "자동" 수입 항목으로 얹고, 이 테이블에는 아예 못 넣게 스키마로 막는다(경고가 아니라 차단).
--
-- amount 는 항상 양수(원 단위 정수) — 수입/지출 부호는 direction 컬럼으로만 구분한다(직관적이고,
-- "지출은 음수로 저장" 식의 규칙이 화면마다 다시 발명되는 걸 막는다).
create table if not exists finance_ledger(
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branch(id) on delete cascade,
  date       date not null,                              -- 발생일(현금이 오간 날짜 기준, 발생주의 아님)
  direction  text not null check (direction in ('income','expense')),
  category   text not null,
  amount     int  not null check (amount > 0),
  memo       text,
  created_by uuid references person(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (direction = 'income'  and category in ('tuition','other')) or
    (direction = 'expense' and category in ('payroll','rent','utility','supplies','ingredients','other'))
  )
);
-- 조회 축은 항상 "지점 + 월"(그 달 손익, 최근 12개월 추이) — date 범위 스캔에 맞춘 인덱스.
create index if not exists idx_finance_ledger_branch_date on finance_ledger(branch_id, date);

-- ================= 학원비 결제(상품 + 결제 + 수강기간) =================
-- 상품(패키지) — 지점별 판매 목록("관리반", "윈터 관리반", "재학생", "N수생" 등). price 는 정가.
-- 결제할 때는 이 정가를 그대로 쓰지 않고 billing_payment.list_price 로 스냅샷을 찍는다 — 나중에
-- 여기 price 를 바꿔도 이미 끝난 결제의 금액이 흔들리면 안 되기 때문(lunch_meal.price 주석과 같은
-- 문제, 같은 해법). 판매중지(active=false)해도 과거 결제·통계는 그대로 남아야 하므로 상품 자체는
-- 지우지 않는다(soft off).
create table if not exists billing_product(
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branch(id) on delete cascade,
  name          text not null,
  price         int  not null check (price >= 0),
  duration_days int  not null default 30 check (duration_days > 0), -- 결제 1건이 늘려주는 일수
  active        boolean not null default true,
  ord           int  not null default 0,
  memo          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references person(id) on delete set null
);
create index if not exists idx_billing_product_branch on billing_product(branch_id, active, ord);

-- 결제 1건 = 학생 × 상품 한 묶음. list_price(결제 시점 정가 스냅샷)와 paid_amount(실제 받은 금액)를
-- 둘 다 저장하고, 할인액은 저장하지 않는다 — list_price - paid_amount 로 항상 계산해서 두 값이
-- 어긋날 여지를 없앤다(집주인 지시). discount_reason 은 "왜 깎아줬는지"만 남겨서 나중에 할인
-- 규칙(과목 수 할인 등)을 만들 때 근거 데이터로 쓴다 — 지금은 규칙을 만들지 않는다(실 할인
-- 데이터가 쌓이기 전에 규칙부터 만들면 안 맞는 규칙이 굳는다).
-- period_start/period_end 는 등록 시점에 src/lib/tuition.ts computePeriod() 로 계산해 그 결과를
-- 그대로 저장한다(조회할 때마다 다시 계산하지 않음) — 그래야 그 결제를 등록한 사람이 화면에서
-- 확인한 "언제부터 언제까지"가 이후에도 절대 안 바뀐다. 삭제 시 다른 결제의 기간을 재계산하지
-- 않는 이유도 같은 맥락(tuition.ts 주석 참고).
-- external_ref 는 카드사·PG 연동을 나중에 붙일 자리로 미리 마련한 칸(지금은 연동이 없어 수기 메모로만
-- 쓰이거나 비워둔다) — 결제수단이 카드일 때 승인번호 같은 걸 적어두는 용도로 지금부터 써도 된다.
create table if not exists billing_payment(
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branch(id) on delete cascade,
  student_id      uuid not null references student(id) on delete cascade,
  product_id      uuid references billing_product(id) on delete set null, -- 상품이 지워져도 결제 기록은 남김
  product_name    text not null, -- 상품명 스냅샷(상품명이 나중에 바뀌거나 상품이 지워져도 안 흔들림)
  list_price      int  not null check (list_price >= 0),
  paid_amount     int  not null check (paid_amount >= 0), -- 정가보다 클 수 있음(추가결제) — 음수만 막는다
  discount_reason text,
  method          text not null check (method in ('card','transfer','cash')),
  paid_date       date not null, -- 결제일(기간 계산의 입력값)
  period_start    date not null,
  period_end      date not null,
  memo            text,
  external_ref    text,
  created_by      uuid references person(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (period_end >= period_start)
);
-- 조회 축: "지점 + 학생"(그 학생의 결제 이력·현재 만료일), "지점 + 기간"(만료 임박·만료 목록, 그
-- 달 재무 자동집계) — 학생 90명의 현재 수강상태를 한 번에 가져올 때 이 인덱스로 충분하다(N+1 금지).
create index if not exists idx_billing_payment_branch_student on billing_payment(branch_id, student_id, period_end desc);
create index if not exists idx_billing_payment_branch_period on billing_payment(branch_id, period_end);
create index if not exists idx_billing_payment_branch_paid_date on billing_payment(branch_id, paid_date);

-- 학생 메모 — 결제 화면에서 그 학생을 고르는 즉시 보여서 "예외 할인이 있는지" 바로 확인하기 위함
-- (집주인 지시). student 관리 화면(다른 작업이 편집 중)과 무관하게 이 칸 하나만 얹는다.
alter table student add column if not exists memo text;

-- ================= 문자 발송 큐(알리고) =================
-- 왜 큐인가: 알리고 API 키가 IP 화이트리스트에 묶여 있고 Vercel(서버리스)은 나가는 IP 가 고정이
-- 아니라 서버에서 직접 발송을 못 부른다. 그렇다고 브라우저에서 직접 부르면 API 키가 노출된다.
-- 그래서 웹앱은 여기 큐에 "보낼 것"만 쌓고, 등록된 고정 IP 를 가진 원내 기기에서 도는 별도
-- 스크립트(scripts/sms-worker.mjs)가 이 큐를 가져가 알리고를 대신 불러준다. 한 줄 = 문자 한 건.
--
-- phone 은 student.guardian_phone/student_phone 을 참조가 아니라 값을 복사해 담는다 — 이유 둘:
-- (1) 학생이 나중에 번호를 바꿔도 이미 큐에 쌓인(또는 이미 보낸) 문자의 수신처가 조용히 바뀌면
--     안 된다 — billing_payment.list_price 를 스냅샷으로 고정하는 것과 같은 이유(tuition.ts 주석).
-- (2) 학생이 삭제(hard delete 되는 경로가 있다면)돼도 이미 보낸 문자의 발송 기록(누구에게 뭘
--     보냈는지)은 남아야 한다 — student_id 는 on delete set null 로 "관련 학생" 링크만 끊는다.
-- kind — 이 문자가 "무엇 때문에" 나가는지. src/lib/sms.ts SMS_KINDS 가 단일 출처(finance_ledger
-- category 와 같은 관례) — 이 체크 제약이 그 목록과 정확히 같은 값만 허용한다. 'test' 는 발송기
-- 배선을 확인할 때만 쓰는 QA 전용 종류(관리 화면의 "테스트 발송 추가"가 이 kind 로 넣는다).
-- 나머지는 다음 단계에서 실제로 붙일 지점들(접속코드 안내·수강만료·미납·공지) 자리를 미리 마련한
-- 것뿐 — 이번 작업은 어디서도 이 kind 들로 실제 insert 를 하지 않는다.
--
-- status 는 4단계: queued(대기) → sending(발송기가 선점) → sent(성공) | failed(재시도 소진).
-- 원자적 선점: 발송기 여러 대가 동시에 돌아도 같은 행을 두 번 집어가면 안 되므로
--   update sms_message set status='sending', attempts=attempts+1, ...
--     where id = (select id from sms_message where status='queued' and next_attempt_at<=now()
--                  order by requested_at limit 1 for update skip locked)
--   returning *
-- 형태로 부른다(scripts/sms-worker.mjs claimNext 참고) — "골라서(select) 나중에 업데이트"가 아니라
-- 서브쿼리의 for update skip locked 로 다른 워커가 동시에 같은 행을 고르지 못하게 잠그면서, 이미
-- 누가 잠근 행은 기다리지 않고 건너뛴다. update...where status='queued'... 자체가 원자적이라
-- 두 워커가 동시에 같은 id 를 잡아도 하나만 status 전이에 성공한다(레이스 없음).
--
-- next_attempt_at — 재시도 백오프. 실패했고 attempts 가 아직 상한(SMS_MAX_ATTEMPTS=3, sms.ts) 밑이면
-- 발송기가 status 를 다시 'queued' 로, next_attempt_at 을 now()+5분 뒤로 돌려놓는다(즉시 재시도가
-- 같은 실패를 반복하며 알리고에 스팸처럼 두들기는 걸 막는다). 상한에 닿으면 status='failed' 로
-- 확정하고 더 이상 자동 재시도하지 않는다(관리 화면의 "다시 보내기"가 수동으로만 재큐잉).
create table if not exists sms_message(
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branch(id) on delete cascade,
  student_id      uuid references student(id) on delete set null, -- 관련 학생(선택) — 링크만, 발송 대상은 phone
  phone           text not null,                                  -- 수신 번호 스냅샷(참조 아님, 위 주석)
  body            text not null,
  kind            text not null check (kind in ('test','access_code','expiry_reminder','unpaid_reminder','notice_broadcast','schedule_reminder','attend_in','attend_out','manual')),
  status          text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(), -- 이 시각 이전엔 발송기가 이 행을 집지 않는다(백오프)
  last_error      text,                                -- 알리고 응답 오류(예: "-101 IP 인증오류") 등 마지막 실패 사유
  aligo_msg_id    text,                                -- 알리고가 성공 시 돌려주는 식별자(msg_id)
  requested_by    uuid references person(id) on delete set null, -- 큐에 넣도록 요청한 사람
  requested_at    timestamptz not null default now(),
  sent_at         timestamptz,                          -- 알리고가 성공을 돌려준 시각(성공 확정 시각, 실제 수신 확인이 아님)
  created_at      timestamptz not null default now()
);
-- 조회 축 둘: "지점 + 상태 + 요청시각"(발송함 목록 — 대기/성공/실패 탭별 최신순), "지점 + 학생"(그
-- 학생에게 보낸 문자 이력). 발송기의 선점 쿼리(status='queued' and next_attempt_at<=now() order by
-- requested_at)도 첫 인덱스로 충분히 커버된다(별도 인덱스 불필요).
create index if not exists idx_sms_message_branch_status_requested on sms_message(branch_id, status, requested_at desc);
create index if not exists idx_sms_message_branch_student on sms_message(branch_id, student_id);

-- 같은 사람에게 같은 종류·같은 내용을 짧은 시간 안에 중복으로 쌓지 못하게 막는 부분 유니크 인덱스.
-- 시간 창을 두는 이유(완전 유니크가 아니라 "최근 N분 내 중복만" 막는 이유)는 앱단(sms.ts
-- enqueueSms)에서 SELECT 로 먼저 검사한다 — 유니크 인덱스로는 "10분 창"처럼 움직이는 조건을 표현할
-- 수 없어서다(created_at 을 포함한 부분 인덱스는 값이 바뀌는 window 를 표현 못함). 대신 이 인덱스는
-- "지점+번호+종류+본문" 조합 조회를 빠르게 만드는 용도로만 쓴다(그 검사 쿼리 자체의 인덱스).
create index if not exists idx_sms_message_dedup_lookup on sms_message(branch_id, phone, kind, requested_at desc);

-- kind 체크 제약 갱신 — 이 테이블은 이전 SCHEMA_VERSION 에서 이미 만들어졌을 수 있어(위 create table
-- if not exists 는 그 경우 아무것도 하지 않는다) 새 kind(schedule_reminder/attend_in/attend_out)를
-- 쓰려면 기존 제약을 갈아끼워야 한다. 이름은 Postgres 기본 명명 규칙(<table>_<column>_check)을 그대로
-- 따른다(이 컬럼은 처음부터 이름 없는 인라인 check 였으므로). 여러 번 실행해도 안전(멱등).
alter table sms_message drop constraint if exists sms_message_kind_check;
alter table sms_message add constraint sms_message_kind_check
  check (kind in ('test','access_code','expiry_reminder','unpaid_reminder','notice_broadcast','schedule_reminder','attend_in','attend_out','manual'));

-- ================= 문자 발송 문구 템플릿 =================
-- 상황(situation)별 문구를 코드가 아니라 여기 표에 둔다 — 집주인이 화면(/m/sms 템플릿 탭)에서 직접
-- 고칠 수 있어야 하기 때문(코드에 박으면 문구 하나 고치는 데 배포가 필요해진다). 지점별로 문구가
-- 다를 수 있어(학원 이름·어투) branch_id 를 포함해 지점마다 한 행씩 둔다(role/permission 처럼 전역
-- 공유하지 않는다).
--
-- situation 카탈로그는 src/lib/sms-template.ts SITUATION_META 가 단일 출처(sms.ts SMS_KINDS 와 같은
-- 관례) — 이 체크 제약이 그 목록과 정확히 같은 값만 허용한다.
--
-- enabled 의 뜻은 상황이 자동이냐 수동이냐에 따라 다르다:
--   자동(attend_in, attend_out, expiry_reminder, expired) — 꺼져 있으면 조건이 되어도(입·퇴실 기록,
--     이용기간 만료) 절대 큐잉하지 않는다(기본값 false, 집주인이 화면에서 하나씩 켜야 동작 — 자동
--     발송은 사람이 안 보는 새 돈이 나가는 일이라 기본 꺼짐이 안전측 기본값이다). attend_in/
--     attend_out 은 꺼져 있으면 직원이 화면에서 수동으로 입·퇴실을 체크할 때도 "문자를 보낼까요?"
--     확인조차 뜨지 않는다(보낼 방법 자체가 잠긴 상태) — sms-auto.ts, attendanceActions.ts 참고.
--   수동(access_code, notice_broadcast, schedule_reminder) — 꺼져 있으면 관리 화면의 "보내기" 버튼을
--     숨긴다(문구가 아직 다듬어지지 않았을 때 집주인이 일시적으로 막을 수 있게). 기본값 true(바로
--     쓸 수 있어야 하므로).
--
-- body 는 {변수} 형태의 자리표시자를 담을 수 있다. 어떤 상황에 어떤 변수가 허용되는지도
-- SITUATION_META 가 정답이고, 저장 시(templateActions.ts) 허용되지 않은 변수가 있으면 막는다 —
-- 발송 후에 "{만료일}" 이 그대로 나가는 사고를 저장 시점에 차단하기 위함.
create table if not exists sms_template(
  branch_id  uuid not null references branch(id) on delete cascade,
  situation  text not null check (situation in ('access_code','notice_broadcast','schedule_reminder','attend_in','attend_out','expiry_reminder','expired')),
  title      text not null,
  body       text not null,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references person(id) on delete set null,
  primary key(branch_id, situation)
);
`;
