import "server-only";
import { db } from "./db";
import { ready } from "./bootstrap";

// 공개 폼(/f/**) 공용 본인확인 모듈.
// dev 저장소에서는 이 로직을 src/app/apply/actions.ts(도시락 전용, 배포 클론엔 이관하지 않음) 의
// findStudent 를 재-export 해서 썼지만, apply/** 는 배포 대상이 아니라서 여기 그대로 인라인했다
// (로직은 dev 와 동일 — 이름+코드 조회, access_attempt 테이블 기반 15분/10회 잠금).
// dev 의 findStudent 를 고치면 이 사본도 맞춰 고칠 것. 클라이언트에서 직접 호출하는 경로는
// src/lib/public-auth-client.ts(= "use server" 래퍼) 를 통해서만 이 함수를 재사용한다.

// 무차별 대입 방어 파라미터: (지점,이름)별 WINDOW 내 THRESHOLD회 실패 시 LOCK 동안 잠금.
const ATTEMPT_WINDOW = "15 minutes";
const ATTEMPT_THRESHOLD = 10;
const ATTEMPT_LOCK = "15 minutes";

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

/** 이름+코드로 재원생을 찾는다(지점 내 유일 코드 → 정확히 1명). 무차별 대입 방어 포함.
 *  isRepeat = student.is_repeat(성인=N수생) — 공개 폼(/f/**)이 시간 기본값을 정할 때 쓴다. */
export async function findStudent(
  name: string,
  code: string,
): Promise<{ ok: true; id: string; name: string; isRepeat: boolean } | { ok: false; reason: "none" | "input" | "locked" }> {
  await ready();
  const nm = name.trim();
  const cd = code.trim();
  if (!nm || !cd) return { ok: false, reason: "input" };
  const branch = await branchId();
  if (!branch) return { ok: false, reason: "none" };

  // 잠금 확인 — 코드 대조 전에 차단(잠긴 이름은 아예 시도 불가).
  const locked = await db.query(
    `select 1 from access_attempt where branch_id=$1 and name=$2 and locked_until is not null and locked_until > now()`,
    [branch, nm],
  );
  if (locked.rows.length > 0) return { ok: false, reason: "locked" };

  const r = await db.query<{ id: string; name: string; is_repeat: boolean }>(
    `select id, name, is_repeat from student where branch_id=$1 and status='enrolled' and name=$2 and access_code=$3`,
    [branch, nm, cd],
  );

  if (r.rows.length === 1) {
    // 성공 → 실패 기록 초기화
    await db.query(`delete from access_attempt where branch_id=$1 and name=$2`, [branch, nm]);
    return { ok: true, id: r.rows[0].id, name: r.rows[0].name, isRepeat: r.rows[0].is_repeat === true };
  }

  // 실패 누적(윈도우 만료 시 리셋, THRESHOLD 도달 시 잠금) — 단일 원자 upsert.
  await db.query(
    `insert into access_attempt(branch_id, name, fails, first_fail) values ($1,$2,1,now())
     on conflict (branch_id, name) do update set
       fails = case when access_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then 1 else access_attempt.fails + 1 end,
       first_fail = case when access_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then now() else access_attempt.first_fail end,
       locked_until = case when (case when access_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then 1 else access_attempt.fails + 1 end) >= ${ATTEMPT_THRESHOLD}
         then now() + interval '${ATTEMPT_LOCK}' else access_attempt.locked_until end`,
    [branch, nm],
  );
  return { ok: false, reason: "none" };
}

/** 본인확인 실패 사유 → 문구. apply/actions.ts 의 authError 와 동일한 문구를 쓴다
 *  (이름/코드 어느 쪽이 틀렸는지 알려주지 않는다 — 무차별 대입 힌트 차단). */
export function publicAuthError(reason: "none" | "input" | "locked"): string {
  return reason === "locked" ? "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." : "이름과 코드를 확인해주세요.";
}
