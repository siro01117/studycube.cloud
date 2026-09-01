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
const SCHEMA_VERSION = "2026-08-31.5"; // 도시락: lunch_meal.price 단가 스냅샷 추가

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

  // 마스터 계정. 없을 때만 생성(있으면 PIN 을 덮어쓰지 않는다).
  // irium = 관리자용 별도 계정 — 지금은 권한 동일, 추후 역할 구분용.
  const MASTERS: [login: string, name: string, pin: string][] = [
    ["나한결", "나한결", "365785"],
    ["irium", "관리자", "140988"],
  ];
  for (const [login, name, pin] of MASTERS) {
    const exists = await db.query(`select 1 from person where login_id=$1`, [login]);
    if (exists.rows.length === 0) {
      await db.query(
        `insert into person(login_id,name,pin_hash,is_cto) values ($1,$2,$3,true)`,
        [login, name, hashPin(pin)],
      );
    }
  }

  // 여기까지 왔으면 이 버전으로 완료. 다음 부팅부터는 판정 쿼리 한 번으로 끝난다.
  await db.query(
    `insert into app_meta(key,value) values ('schema_version',$1)
     on conflict (key) do update set value=excluded.value, updated_at=now()`,
    [SCHEMA_VERSION],
  );
}
