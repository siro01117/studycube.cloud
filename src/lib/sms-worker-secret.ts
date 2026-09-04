// 문자 발송기(scripts/sms-worker.mjs) 공유 비밀 — src/lib/entrance.ts 의 입구 태블릿 기기 토큰과
// 같은 원칙을 그대로 따른다: 원문은 발급 응답에서 한 번만 보여주고 DB 에는 해시만(hash.ts scrypt)
// 남긴다. 잃어버리면 재발급, 재발급하면 이전 값은 즉시 무효.
//
// 새 표를 만들지 않고 branch_setting(이미 sms_expiry_daily_time 등이 쓰는 지점별 k/v 표)을 그대로
// 쓴다 — 비밀 하나·발급 시각·발급자 세 값이라 표 하나 새로 만들 만큼 무겁지 않고, 지점 단위 저장이라는
// 모양이 branch_setting 의 기존 쓰임과 정확히 같다.
//
// 다만 이 비밀을 실제로 검증하는 api/sms-worker 라우트는 로그인 세션이 없고 claim/report 모두
// 지점을 넘겨받지 않는다(발송기 하나가 전 지점 큐를 함께 처리 — route.ts 상단 주석). 그래서 검증은
// "이 값이 어느 지점이든 저장된 해시와 맞는가"로 한다(verifySmsWorkerSecretAnyBranch). 발급·재발급은
// 화면에서 관리자의 활성 지점(activeBranchId) 기준으로 한다.
import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashPin, verifyPin } from "./hash";

const KEY_HASH = "sms_worker_secret_hash";
const KEY_ISSUED_AT = "sms_worker_secret_issued_at";
const KEY_ISSUED_BY = "sms_worker_secret_issued_by";

export type SmsWorkerSecretMeta = { issuedAt: string; issuedBy: string };

/** 발급 여부·시각·발급자만(해시 자체는 절대 돌려주지 않는다 — 원문 재구성 재료가 되지 않게). */
export async function getSmsWorkerSecretMeta(branchId: string): Promise<SmsWorkerSecretMeta | null> {
  const r = await db.query<{ key: string; value: string }>(
    `select key, value from branch_setting where branch_id=$1::uuid and key in ($2, $3)`,
    [branchId, KEY_ISSUED_AT, KEY_ISSUED_BY],
  );
  const issuedAt = r.rows.find((row) => row.key === KEY_ISSUED_AT)?.value;
  const issuedBy = r.rows.find((row) => row.key === KEY_ISSUED_BY)?.value;
  if (!issuedAt) return null;
  return { issuedAt, issuedBy: issuedBy ?? "" };
}

/** 발급/재발급 — entrance.ts issueDevice/reissueDevice 와 같은 모양(같은 키를 upsert 하는 것 자체가
 *  재발급). 원문은 이 함수 리턴값에서만 보이고 DB 에는 해시만 남는다(재조회 불가). */
export async function issueSmsWorkerSecret(branchId: string, issuedByName: string): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  const hash = hashPin(secret);
  const nowIso = new Date().toISOString();
  await db.query(
    `insert into branch_setting(branch_id, key, value) values
       ($1::uuid, $2, $3),
       ($1::uuid, $4, $5),
       ($1::uuid, $6, $7)
     on conflict (branch_id, key) do update set value=excluded.value, updated_at=now()`,
    [branchId, KEY_HASH, hash, KEY_ISSUED_AT, nowIso, KEY_ISSUED_BY, issuedByName],
  );
  return secret;
}

/** api/sms-worker 라우트 전용 검증. 지점을 모른 채로 넘어온 값을 전 지점의 저장된 해시와 대조한다
 *  (지점이 몇 안 되므로 순회 비용은 무시할 만하고, verifyPin 내부가 이미 scrypt+timingSafeEqual 라
 *  타이밍 안전하다). 빈 값은 즉시 거부. */
export async function verifySmsWorkerSecretAnyBranch(secret: string): Promise<boolean> {
  if (!secret) return false;
  const r = await db.query<{ value: string }>(`select value from branch_setting where key=$1`, [KEY_HASH]);
  for (const row of r.rows) {
    if (verifyPin(secret, row.value)) return true;
  }
  return false;
}
