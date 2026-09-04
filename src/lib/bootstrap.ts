// 코어 스키마 + 시드 (로컬 개발용, 멱등 — 여러 번 돌려도 안전).
// 배포 때는 같은 내용을 Supabase 마이그레이션 SQL로 옮김.
import { db } from "./db";
import { hashPin } from "./hash";
import { PERMISSIONS } from "./perms";
import { MODULES } from "./modules";
import { MODULE_SQL } from "./schema.modules";
import { normalizeLoginId } from "./hangul-romanize";
import { SMS_SITUATIONS, SITUATION_META } from "./sms-template";

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
-- 전역 역할(branch_id is null) 은 key 로 유일 — CTO/관리자 시드를 매 부팅마다 중복 insert 하지
-- 않기 위한 on conflict 타깃. branch_id 가 not null 인 지점별 역할은 이 인덱스와 무관(부분 인덱스).
create unique index if not exists uq_role_global_key on role(key) where branch_id is null;

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

-- 직원 로그인 무차별 대입 방어 (access_attempt 와 같은 원리이되 별도 테이블 — access_attempt 는
-- "(지점,학생이름)" 단위로 학생 공개 폼 전용이라 branch_id 가 필수고 지점 내에서만 의미가 있다.
-- 직원 로그인은 지점과 무관한 계정 단위 자원이라(로그인 성공 전엔 어느 지점 소속인지도 모른다)
-- login_id 하나만으로 전역 잠금을 건다. 계정 존재 여부를 잠금 유무로 흘리지 않기 위해 실제 person
-- 존재와 무관하게 "정규화된 입력 문자열" 기준으로 실패를 쌓는다(auth.ts 참고).
create table if not exists login_attempt(
  login_id     text primary key,
  fails        int  not null default 0,
  first_fail   timestamptz not null default now(),
  locked_until timestamptz
);

-- ================= 직원 계정 생성·삭제 신청 (관리자 신청 → CTO 승인) =================
-- schedule_request(schema.modules.ts)와 같은 대기/승인/반려 + 처리자·처리시각 패턴을 그대로 따른다.
-- 관리자(원내 공통)는 account.request 권한으로 신청만 하고, 승인·반려는 account.provision 권한
-- (CTO 전용, is_cto bypass)만 할 수 있다 — perms.ts / 아래 역할 시드 참고.
-- '삭제' 신청은 실제 row 삭제가 아니라 person.active=false 처리다(학생의 퇴원→휴원 통합과 같은 이유
-- — 완전 삭제는 person_role/결정자(decided_by) 등 FK 로 얽힌 이력을 깨뜨리고, 되돌릴 수도 없다).
-- 2026-09-01(직원 관리 화면): create 신청은 더 이상 아이디를 미리 받지 않는다 — 승인되면 초대 코드가
-- 발급되고 본인이 아이디·비밀번호를 정한다(login_id 컬럼은 과거 흐름의 잔재로 남겨두되 새 코드는 안 씀).
-- req_type 에 'edit'을 추가해 정보 수정도 같은 신청/승인 갈림을 탄다(account.provision 은 직접 수정,
-- account.request 만 있으면 신청 후 대기).
create table if not exists account_request(
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid references branch(id) on delete cascade,
  req_type         text not null check (req_type in ('create','edit','delete')),
  requested_by     uuid not null references person(id) on delete cascade,
  target_person_id uuid references person(id) on delete cascade, -- edit/delete 신청 대상 (create 시 null)
  login_id         text, -- (구) create 신청 시 제안 아이디 — 더 이상 새로 채우지 않음
  name             text, -- create/edit 신청 시 이름
  phone            text, -- create/edit 신청 시 연락처
  title            text, -- create/edit 신청 시 직함(선택)
  hired_at         date, -- create/edit 신청 시 입사일
  left_at          date, -- delete(퇴사) 신청 시 퇴사일(비우면 승인 시각의 날짜)
  role_id          uuid references role(id) on delete set null, -- create/edit 신청 시 배정 역할(선택)
  reason           text,
  status           text not null default 'pending', -- pending | approved | rejected
  note             text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references person(id) on delete set null
);
create index if not exists idx_account_request_status on account_request(branch_id, status);

-- 직원 초대 코드 — account.provision 보유자의 직접 처리, 또는 account_request(create) 승인 시 발급.
-- 이 시점엔 아직 person 행이 없다(로그인 계정이 아니다) — 본인이 /invite/[code] 에서 아이디·비밀번호를
-- 직접 정하고 나서야 person 행이 생긴다(person.login_id/pin_hash 는 not null 이라 그 전엔 만들 수 없다).
-- code 는 32자 커스텀 알파벳(0/O/1/I/L 제외) 10자 = 약 50비트 엔트로피 — 유효기간(7일) 안에 무차별
-- 대입으로 맞힐 확률이 사실상 0이라 login_attempt 류의 잠금 테이블 없이 길이만으로 방어한다
-- (근거는 CLAUDE 보고 참고). 1회용(status 로 강제).
create table if not exists staff_invite(
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references branch(id) on delete cascade,
  code                text unique not null,
  name                text not null,
  phone               text,
  title               text,
  hired_at            date,
  role_id             uuid references role(id) on delete set null,
  status              text not null default 'pending', -- pending | used | revoked (만료는 expires_at 로 판정, status 를 따로 옮기지 않음)
  account_request_id  uuid references account_request(id) on delete set null, -- 신청 승인으로 발급된 경우만
  created_by          uuid not null references person(id) on delete cascade,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  used_at             timestamptz,
  used_by_person_id   uuid references person(id) on delete set null
);
create index if not exists idx_staff_invite_branch_status on staff_invite(branch_id, status);

-- 앱 메타(스키마 버전 등). 이게 있어야 부팅을 건너뛸 수 있는지 판정한다.
create table if not exists app_meta(
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
`;

let booted: Promise<void> | null = null;

/** 코어 스키마·시드를 한 번만 실행하고, 이후엔 즉시 반환.
 *  실패는 절대 캐시하지 않는다 — 캐시하면 서버 인스턴스 하나가 살아있는 내내
 *  같은 옛 에러만 계속 던져서 "고쳤는데도 안 되는" 상태가 된다. */
export function ready(): Promise<void> {
  if (!booted) {
    const p: Promise<void> = (booted = boot().catch((e) => {
      if (booted === p) booted = null; // 다음 요청에서 재시도 (boot()은 멱등)
      throw e;
    }));
  }
  return booted;
}

// 여러 서버 인스턴스가 동시에 부팅하면 create table/index 가 서로 충돌한다.
// 같은 multi-statement 안에서 트랜잭션 락을 먼저 잡아 한 번에 하나만 실행되게 한다.
// (별도 문장으로 분리하면 pooler가 다른 커넥션에 배정해서 의미가 없다)
// 로컬 PGlite 는 단일 프로세스라 경합이 없고, advisory lock 을 만나면 WASM 이 죽는다 → 배포에서만 건다.
const BOOT_LOCK =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL
    ? `select pg_advisory_xact_lock(918273645);\n`
    : "";

// 스키마·시드 내용이 바뀌면 이 값을 올린다. 그때만 DDL 이 다시 돈다.
// (schema.modules.ts / CORE_SQL / PERMISSIONS / MODULES 를 수정하면 반드시 갱신)
const SCHEMA_VERSION = "2026-09-03.2"; // .1 은 seed 루프를 boot() 에 추가하기 전에 이미 커밋돼(개발 중
// 살아있던 서버가 그 사이 요청을 받아 버전만 먼저 기록) 시드가 비어 있는 상태로 굳어버린 이력이 있다
// (문자 템플릿 seed 재실행을 위해 .2 로 다시 올림 — sms_template 실제 로딩 결과가 그 증거).

/** 이미 이 버전으로 부팅된 DB인지 한 번의 쿼리로 판정 */
async function alreadyBooted(): Promise<boolean> {
  try {
    const r = await db.query<{ value: string }>(
      `select value from app_meta where key='schema_version'`,
    );
    return r.rows[0]?.value === SCHEMA_VERSION;
  } catch {
    return false; // app_meta 자체가 없음 = 최초 부팅
  }
}

async function boot() {
  // 콜드 스타트마다 DDL 전체(70여 회 왕복)를 돌리면 요청이 수십 초씩 걸리고,
  // 동시에 뜬 인스턴스들이 advisory lock 뒤에 줄을 선다. 이미 최신이면 즉시 종료.
  if (await alreadyBooted()) return;
  console.log(`[bootstrap] 스키마·시드 실행 (${SCHEMA_VERSION})`); // 실제로 돌 때만 찍힌다

  await db.exec(BOOT_LOCK + CORE_SQL);
  await db.exec(BOOT_LOCK + MODULE_SQL); // 이식된 모듈 테이블
  // 직원 정보 확장(2026-09-01): 전부 선택 입력. 시급/계좌/주민번호는 의도적으로 넣지 않는다 —
  // 시급은 적용 시작일이 있는 이력이라 급여 단계에서 별도 테이블로(도시락 가격 소급 변경 문제와 같은
  // 이유), 계좌·주민번호는 암호화·접근통제 없이 평문 컬럼으로 저장하지 않는다.
  await db.query(`alter table person add column if not exists phone text`);
  await db.query(`alter table person add column if not exists title text`); // 실장·조교·강사 등 표시용(권한과 무관)
  await db.query(`alter table person add column if not exists hired_at date`);
  await db.query(`alter table person add column if not exists left_at date`);
  await db.query(`alter table person add column if not exists memo text`);
  // 직원 관리 화면(2026-09-01): account_request 에 초대 코드 흐름을 위한 컬럼을 얹는다(신규 DB는 CORE_SQL
  // 이 이미 포함하므로 이 ALTER 들은 기존 DB에만 실질적 효과가 있다 — 전부 멱등).
  await db.query(`alter table account_request add column if not exists phone text`);
  await db.query(`alter table account_request add column if not exists hired_at date`);
  await db.query(`alter table account_request add column if not exists left_at date`);
  await db.query(`alter table account_request add column if not exists role_id uuid references role(id) on delete set null`);
  // req_type 체크 제약에 'edit' 추가 — 이름이 자동 생성(<table>_<col>_check)이라 그 이름으로 드롭한다.
  await db.query(`alter table account_request drop constraint if exists account_request_req_type_check`);
  await db.query(`alter table account_request add constraint account_request_req_type_check check (req_type in ('create','edit','delete'))`);
  // 학생용 공지(2026-09-01): 기존 notice 는 전부 직원용이었다 — 새 컬럼은 기본값 'staff' 로 채워져
  // 기존 행·기존 화면(m/notice, /notice) 그대로 동작한다. 학생 읽음은 notice_read(person 기준)를
  // 재사용할 수 없어(학생은 person 행이 없다) notice_student_read 를 별도로 둔다(MODULE_SQL 참고).
  await db.query(`alter table notice add column if not exists audience text not null default 'staff'`);
  await db.query(`alter table notice drop constraint if exists notice_audience_check`);
  await db.query(`alter table notice add constraint notice_audience_check check (audience in ('staff','student'))`);
  // 상태 모델 변경(2026-07-20): 퇴원(withdrawn) 폐지 → 휴원(leave)로 통합
  await db.query(`update student set status='leave' where status='withdrawn'`);
  // 도시락 신청 파일럿(2026-07-24): 기존 지점의 lunch 모듈을 켠다(신규는 아래 mvp 시드가 처리).
  await db.query(`update branch_module set enabled=true where module_key='lunch'`);
  // 자습은 더 이상 블록으로 저장하지 않는다(등하원 시각 + statusAt 파생 판정으로 대체). 구방식 잔여 행 정리.
  await db.query(`delete from schedule_rule where kind='study'`);
  // schedule_exception.skip_rule_id 는 "이 날만 정기 규칙을 대체" 마커로 쓰인다(위에서 study 규칙을 지우면
  // 그 규칙을 가리키던 skip_rule_id 는 FK(on delete set null)로 이미 null 처리됨).
  // skip_rule_id 가 아직 남아있는 study 예외는 다른(academy 등) 살아있는 정기 규칙을 이 날만 대체하는 마커일 수 있어
  // 지우면 그 규칙이 해당 날짜에 되살아나 버린다 — 그래서 대체 대상이 없는(skip_rule_id 없는) 구방식 study 예외만 지운다.
  await db.query(`delete from schedule_exception where kind='study' and skip_rule_id is null`);
  // 스케쥴 입력 기간(2026-08-20): 기존 제출 행은 first_submitted_at 이 없다 — created_at 을 최초
  // 제출 시각으로 간주해 채운다(그 순간부터는 actions.ts submitForm 이 insert 시에만 채우고 보존).
  await db.query(`update submission set first_submitted_at = coalesce(first_submitted_at, created_at) where first_submitted_at is null`);
  // 도시락 관리자 등록 폐지(2026-08-31): 신청은 학생 전용이 되어 신청 출처 구분이 의미를 잃었다.
  // 컬럼 삭제를 "이번" 배포에서는 하지 않는다 — 롤링 배포 중에는 직전 빌드의 살아있는
  // 인스턴스가 아직 `insert into lunch_order(..., source) ...` 를 실행 중일 수 있는데, 새 인스턴스가
  // 부팅하자마자 컬럼을 지우면 그 사이 옛 인스턴스의 insert 가 42703(undefined column)으로 실패한다.
  // 코드는 이미 이 컬럼을 읽지도 쓰지도 않으므로(현재 lunch-actions.ts/actions.ts 어디에도 source 언급
  // 없음) 컬럼이 남아 있어도 무해하다 — 새 코드의 insert 는 컬럼을 아예 생략하는데, 이 컬럼은 이번
  // 정리 전부터(구버전 SCHEMA_VERSION 때부터) 이미 그런 생략-insert 와 공존해온 컬럼이라 기본값/null
  // 허용 여부가 이미 검증돼 있다 — 새로 깨질 일이 없다. drop 은 옛 인스턴스가 모두 내려간 뒤인
  // 다음 배포에서 한다.
  // 신청 시점 단가 스냅샷 — 없으면 월 가격을 바꿀 때 이미 완납한 학생이 미납으로 되돌아간다.
  // schema.modules.ts 의 create table if not exists 는 신규 DB만 커버하므로, 이미 존재하는 DB는
  // 여기서 컬럼을 얹는다 — 멱등(add column if not exists), 매 버전마다 다시 돌아도 안전하다.
  await db.query(`alter table lunch_meal add column if not exists price int not null default 0`);
  // 기존 행(마이그레이션 이전에 신청된 끼니)은 그 시점 단가가 어디에도 남아있지 않다 — 되살릴 수
  // 없으므로 최선의 근사치로 "그 달의 현재 가격"을 채운다(기존 화면이 항상 재계산해오던 값과 동일해서
  // 이 UPDATE 직후 총액이 갑자기 바뀌지 않는다).
  // price=0 인 행만 대상으로 삼는 것만으로는 멱등하지 않다 — 이 문장은 SCHEMA_VERSION 이 오를
  // 때마다(이 마이그레이션과 무관한 변경이어도) 매번 다시 돈다. 나중에 관리자가 "가격 미설정 달"의
  // 가격을 정식으로 넣으면, 그 전에 0원으로 신청됐던(그리고 이미 결제까지 끝났을 수 있는) 행이 다음
  // 배포 때 조용히 새 단가로 덮어써진다 — updatePayment 는 이 스냅샷 합계로만 완납 여부를 재계산하므로
  // (paid 자체는 건드리지 않는다) 완납인데 잔액이 생기는 상태가 된다. 다른 마이그레이션의 선례
  // (schedule_grant 무효화, schema.modules.ts)처럼 cutover 시점(이 컬럼을 추가한 SCHEMA_VERSION의
  // 배포 시각) 이전에 만들어진 주문만 대상으로 날짜로 스코프해 최초 1회만 돌게 한다 — 그 시점 이후의
  // 주문은 saveLunchOrder 가 항상 정확한 단가로 직접 저장하므로 백필 대상이 아니다.
  await db.query(`
    update lunch_meal lm
       set price = case when lm.meal_type='lunch' then mo.lunch_price else mo.dinner_price end
      from lunch_order o
      join lunch_month mo on mo.id = o.month_id
     where o.id = lm.order_id and lm.price = 0
       and o.created_at < timestamptz '2026-08-31 00:00+09'
  `);

  // 학원비 결제 모듈(2026-09-02): finance_ledger 에 손으로 넣던 'tuition'(학원비) 수입을 막는다 —
  // billing_payment 가 생겨서 이제 그게 유일한 실제 입금 기록이고(src/lib/finance.ts 주석 참고),
  // 손으로 또 적으면 도시락과 같은 이중계상이 된다. 문제: 이 table-level check 제약은 CREATE TABLE
  // 에서 이름 없이 선언됐다(schema.modules.ts) — 자동 생성된 이름을 예측할 수 없으므로(컬럼 하나에
  // 붙는 <table>_<col>_check 패턴이 아니라 여러 컬럼을 아우르는 조건이라 <table>_check[N] 형태이고
  // 다른 check 개수에 따라 N 이 달라질 수 있다), pg_constraint 에서 정의에 'tuition' 이 들어간 check
  // 를 찾아 이름으로 지운다.
  // 기존에 손으로 적어둔 tuition 행은 과거 회계 기록이라 지우거나 고치지 않고 그대로 둔다 —
  // 새 제약은 NOT VALID 로 걸어서 "이미 있는 행은 검증하지 않되, 앞으로의 insert/update 는 막는다"를
  // 만족시킨다(과거 데이터 무결성과 이중계상 차단을 동시에 얻는다). 매번 다시 돌아도 같은 결과(멱등):
  // 첫 실행에서 옛 제약을 지우고 이름 붙은 새 제약을 걸면, 다음 실행부터는 pg_constraint 검색이
  // 아무것도 못 찾고(이미 이름 붙은 제약뿐이라 정의에 'tuition' 자체가 없음) drop-if-exists+add 만
  // 반복한다.
  await db.query(`
    do $$
    declare r record;
    begin
      for r in
        select conname from pg_constraint
         where conrelid = 'finance_ledger'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) like '%tuition%'
      loop
        execute format('alter table finance_ledger drop constraint %I', r.conname);
      end loop;
    end $$;
  `);
  await db.query(`alter table finance_ledger drop constraint if exists finance_ledger_category_chk`);
  await db.query(`
    alter table finance_ledger add constraint finance_ledger_category_chk
      check (
        (direction = 'income'  and category in ('other')) or
        (direction = 'expense' and category in ('payroll','rent','utility','supplies','ingredients','other'))
      ) not valid
  `);

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

  // 본점 1개 (동시 부팅 시 중복키 나지 않게 on conflict)
  await db.query(
    `insert into branch(name,code,is_hq) values ('본점','HQ',true)
     on conflict (code) do nothing`,
  );
  const hq = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  const hqId = hq.rows[0]?.id;
  if (!hqId) throw new Error("본점(HQ) 생성에 실패했습니다.");

  // 본점 모듈 on/off — MVP만 켬
  for (const m of MODULES) {
    await db.query(
      `insert into branch_module(branch_id,module_key,enabled) values ($1,$2,$3)
       on conflict (branch_id,module_key) do nothing`,
      [hqId, m.key, !!m.mvp],
    );
  }

  // 마스터 계정 아이디 정리(2026-09-01): 로그인 아이디는 앞으로 영문 소문자·숫자만 쓴다.
  // 다만 기존 계정을 자동 변환하면 "나한결" 이 "skgksruf" 같은 읽을 수 없는 문자열이 된다 —
  // 사람이 기억해서 치는 값이므로 자동 변환 대신 의도한 이름으로 한 번만 바꾼다.
  // 멱등: 이미 'cto' 면 아무 것도 하지 않는다.
  await db.query(
    `update person set login_id='cto'
      where login_id in ('나한결','skgksruf') and not exists (select 1 from person p2 where p2.login_id='cto')`,
  );

  // 역할 시드: CTO / 관리자(원내 공통) — 전역 역할(branch_id null).
  // is_cto 플래그는 그대로 전권 bypass 로 남긴다(auth.ts can() 참고) — cto 계정만 is_cto=true 라
  // 이 role/role_permission 시드와 무관하게 계속 전 화면에 접근한다(자기잠금 방지, 나한결은 CTO로
  // 남아야 한다는 요구사항을 그대로 만족). irium 은 아래에서 관리자 역할로만 권한을 받는다.
  // 이 시드는 (1) 앞으로 다지점에서 is_cto 없이도
  // 특정 사람에게 "CTO급 권한"을 역할로 명시 부여하고 싶을 때, (2) 관리자 역할의 실제 권한 집합을
  // 데이터로 남겨 다음 단계 화면(직원 관리·역할 배정)이 그대로 읽어 쓸 수 있게 하기 위함이다.
  // role_permission 은 매번 이 시드로 완전히 재작성한다(추가도 제거도) — 지금은 이 파일이 유일한
  // 출처라서다. 나중에 역할 관리 화면이 생겨 운영자가 직접 권한을 조정하게 되면, 이 재작성 방식은
  // 그 수동 조정을 다음 SCHEMA_VERSION 부팅 때 조용히 덮어써 버리므로 그때는 시드를 "없을 때만
  // 생성"으로 바꿔야 한다(지금은 화면이 없어 문제 없음).
  const ADMIN_PERM_KEYS = [
    "student.view", "student.edit",
    "seat.view", "seat.manage",
    "attendance.view", "attendance.edit",
    "penalty.view", "penalty.manage",
    "patrol.view", "patrol.manage",
    "schedule.view", "schedule.manage",
    "lunch.view", "lunch.manage",
    "notice.view", "notice.manage",
    "staff_schedule.view",  // 직원 일정: 관리자는 조회만, 편집(staff_schedule.manage)은 CTO 전용
    "staff_attendance.view", // 직원 근태: 관리자는 전체 목록 조회만, QR 키오스크·정정(staff_attendance.manage)은 CTO 전용
    "account.request",      // 계정 생성·삭제: 관리자는 신청만, 승인(account.provision)은 CTO 전용
    // 재무·시급·단가(billing.*, payroll.*)는 의도적으로 제외 — 관리자 완전 차단.
    // 문자 발송(sms.*)도 같은 이유로 제외 — 건당 실비 + 학부모 직접 발송이라 CTO 전용.
  ];
  const ROLE_SEEDS: { key: string; label: string; perms: string[] }[] = [
    { key: "cto", label: "CTO", perms: PERMISSIONS.map((p) => p.key) },
    { key: "admin", label: "관리자", perms: ADMIN_PERM_KEYS },
  ];
  for (const roleSeed of ROLE_SEEDS) {
    await db.query(
      `insert into role(branch_id,key,label) values (null,$1,$2)
       on conflict (key) where branch_id is null do update set label=excluded.label`,
      [roleSeed.key, roleSeed.label],
    );
    const rr = await db.query<{ id: string }>(
      `select id from role where key=$1 and branch_id is null`,
      [roleSeed.key],
    );
    const roleId = rr.rows[0]?.id;
    if (!roleId) continue;
    await db.query(`delete from role_permission where role_id=$1`, [roleId]);
    for (const key of roleSeed.perms) {
      await db.query(
        `insert into role_permission(role_id,permission_key) values ($1,$2) on conflict do nothing`,
        [roleId, key],
      );
    }
  }

  // 마스터 계정. 없을 때만 생성(있으면 비밀번호를 덮어쓰지 않는다).
  // cto = 전권 계정(구 "나한결"), irium = 원내 공통 관리자 계정. 아이디는 사람이 기억해 치는 값이라
  // 자동 변환에 맡기지 않고 여기 적힌 그대로 쓴다.
  // cto 만 전권(is_cto)이다. irium 은 원내 공통 관리자 계정이라 전권이면 안 된다 —
  // 재무·시급을 못 보고 계정은 신청만 하는 구분이 is_cto=true 면 통째로 무의미해진다.
  // 시드 비밀번호는 코드에 두지 않는다 — 저장소를 읽을 수 있는 사람이 곧 CTO 로그인을 얻어 버린다.
  //   배포(production): 환경변수가 없으면 그 계정을 아예 만들지 않는다(고정값 폴백 없음).
  //   로컬 개발: 아래 devPin 을 쓴다 — 개발 전용이며 배포에서는 절대 쓰이지 않는다.
  // 비밀번호 값 자체는 로그에 찍지 않는다(미설정 사실만 알린다).
  // process.env 는 번들러 인라이닝 대상이라 리터럴 키로만 읽는다(동적 인덱싱 금지).
  const MASTER_PINS: Record<string, string | undefined> = {
    MASTER_CTO_PIN: process.env.MASTER_CTO_PIN,
    MASTER_IRIUM_PIN: process.env.MASTER_IRIUM_PIN,
  };
  const IS_PROD = process.env.NODE_ENV === "production";
  const MASTERS: { login: string; name: string; envKey: string; devPin: string; cto: boolean }[] = [
    { login: "cto", name: "나한결", envKey: "MASTER_CTO_PIN", devPin: "dev-cto-pin", cto: true },
    { login: "irium", name: "관리자", envKey: "MASTER_IRIUM_PIN", devPin: "dev-irium-pin", cto: false },
  ];
  for (const m of MASTERS) {
    const exists = await db.query(`select 1 from person where login_id=$1`, [m.login]);
    if (exists.rows.length > 0) continue; // 이미 있으면 비밀번호를 덮어쓰지 않는다
    const pin = MASTER_PINS[m.envKey] || (IS_PROD ? "" : m.devPin);
    if (!pin) {
      console.warn(`[bootstrap] ${m.envKey} 미설정 — 마스터 계정 '${m.login}' 시드를 건너뜁니다.`);
      continue;
    }
    await db.query(
      `insert into person(login_id,name,pin_hash,is_cto) values ($1,$2,$3,$4)`,
      [m.login, m.name, hashPin(pin), m.cto],
    );
  }

  // 이미 만들어져 있던 irium 도 전권을 내린다(과거 시드가 is_cto=true 로 만들었다). 권한을 내리기만
  // 하면 아무 화면도 못 보므로 같은 자리에서 관리자 역할을 붙여 준다 — 순서가 뒤바뀌면 잠긴다.
  {
    const admin = await db.query<{ id: string }>(
      `select id from role where key='admin' and branch_id is null limit 1`,
    );
    const hq = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
    const ir = await db.query<{ id: string }>(`select id from person where login_id='irium' limit 1`);
    const roleId = admin.rows[0]?.id, branch = hq.rows[0]?.id, personId = ir.rows[0]?.id;
    if (roleId && branch && personId) {
      await db.query(
        `insert into person_role(person_id, branch_id, role_id) values ($1::uuid,$2::uuid,$3::uuid)
         on conflict (person_id, branch_id, role_id) do nothing`,
        [personId, branch, roleId],
      );
      await db.query(`update person set is_cto=false where id=$1::uuid and is_cto`, [personId]);
    }
  }

  // 문자 템플릿 기본 문구 시드 — 지점마다, 상황마다 한 행씩. on conflict do nothing 이라 이미 집주인이
  // 고친 행은 절대 덮어쓰지 않는다(멱등 + 편집 보존). enabled 기본값은 SITUATION_META.auto 를 따른다
  // (자동 상황은 false=기본 꺼짐, 수동 상황은 true=바로 쓸 수 있게) — sms_template 테이블 주석(schema.modules.ts) 참고.
  {
    const branches = await db.query<{ id: string }>(`select id from branch`);
    for (const b of branches.rows) {
      for (const situation of SMS_SITUATIONS) {
        const meta = SITUATION_META[situation];
        await db.query(
          `insert into sms_template(branch_id, situation, title, body, enabled)
           values ($1::uuid, $2, $3, $4, $5)
           on conflict (branch_id, situation) do nothing`,
          [b.id, situation, meta.defaultTitle, meta.defaultBody, !meta.auto],
        );
      }
    }
  }

  // 여기까지 왔으면 이 버전으로 완료. 다음 부팅부터는 판정 쿼리 한 번으로 끝난다.
  await db.query(
    `insert into app_meta(key,value) values ('schema_version',$1)
     on conflict (key) do update set value=excluded.value, updated_at=now()`,
    [SCHEMA_VERSION],
  );
}
