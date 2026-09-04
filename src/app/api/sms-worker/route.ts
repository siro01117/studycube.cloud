// 문자 발송기(scripts/sms-worker.mjs, 원내 고정 IP 기기에서 도는 별개 스크립트) 전용 API.
// 로그인 세션이 아니라 SMS_WORKER_SECRET 공유 비밀로만 연다 — 이 라우트를 부르는 쪽은 브라우저가
// 아니라 사람이 없는 스크립트이기 때문(CRON_SECRET, api/cron/unexcused-absences 와 같은 이유).
//
// 두 동작을 action 필드로 가른다(라우트를 둘로 안 나눈 이유: 큐를 "가져가고 결과를 되돌려 준다"는
// 한 세트의 왕복이라 스크립트 쪽에서 다루기 쉽게 하나로 묶었다):
//  - claim : 발송 대상 몇 건을 원자적으로 선점해서 돌려준다(다른 발송기가 동시에 돌아도 안전 —
//            아래 SQL 의 for update skip locked, sms.ts 상단 주석 참고).
//  - report: 그 건을 실제로 알리고에 보낸 결과(성공/실패)를 되돌려 준다. 실패면 재시도 정책
//            (SMS_MAX_ATTEMPTS/RETRY_BACKOFF_MINUTES, src/lib/sms.ts)에 따라 큐로 되돌리거나 확정 실패로 닫는다.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { SMS_MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES } from "@/lib/sms";
import { runDailyExpirySmsGeneration } from "@/lib/sms-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SESSION_SECRET(src/lib/auth.ts secret())과 같은 관례: 환경변수가 있으면 그 값, 배포인데 없으면
// 거부(구멍을 열어두지 않는다), 로컬 개발인데 없으면 로컬 전용 고정값으로 폴백(.env.local 을 만지지
// 않고도 로컬에서 발송기 배선을 끝까지 시험할 수 있게 하기 위함 — 이 고정값은 배포에서는 절대
// 쓰이지 않는다, NODE_ENV==='production' 분기가 막는다).
function expectedSecret(): string | null {
  const env = process.env.SMS_WORKER_SECRET;
  if (env) return env;
  if (process.env.NODE_ENV === "production") return null;
  return "dev-only-sms-worker-secret";
}

// 타이밍 안전 비교 — 길이가 다르면 timingSafeEqual 이 예외를 던지므로 먼저 길이로 갈라낸다(길이
// 비교 자체는 시크릿 값을 드러내지 않으므로 안전, src/lib/auth.ts readToken 과 같은 패턴).
function authorized(req: Request): boolean {
  const want = expectedSecret();
  if (!want) return false;
  const auth = req.headers.get("authorization") ?? "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type ClaimedRow = { id: string; phone: string; body: string; kind: string; attempts: number };

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await ready();

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof payload?.action === "string" ? payload.action : "";

  if (action === "claim") {
    // 이용기간 만료 임박·만료 자동 발송(일배치, 기본 12:40 KST)을 여기서 판정한다 — 새 크론을 만들지
    // 않고, 발송기가 이미 5분 간격 안전망으로 claim 을 부르는 경로에 얹는다(sms-auto.ts 상단 주석).
    // 하루 한 번만 실제로 동작(branch_setting 마커)하므로 매번 불려도 대부분은 즉시 끝난다.
    await runDailyExpirySmsGeneration();

    const limitRaw = Number(payload?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 20;
    // 원자적 선점: 서브쿼리의 for update skip locked 가 다른 발송기가 이미 잡은 행을 건너뛰고,
    // 바깥 update 의 where status='queued' 조건 자체가 원자적이라 같은 행을 두 발송기가 동시에
    // 집어가지 못한다(레이스 없음) — sms.ts 상단 주석에 전체 설명.
    const r = await db.query<ClaimedRow>(
      `update sms_message
          set status = 'sending', attempts = attempts + 1
        where id in (
          select id from sms_message
           where status = 'queued' and next_attempt_at <= now()
           order by requested_at
           limit $1
           for update skip locked
        )
        returning id, phone, body, kind, attempts`,
      [limit],
    );
    return NextResponse.json({ ok: true, items: r.rows });
  }

  if (action === "report") {
    const id = typeof payload?.id === "string" ? payload.id : "";
    if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
    const success = payload?.ok === true;
    if (success) {
      const aligoMsgId = typeof payload?.aligoMsgId === "string" ? payload.aligoMsgId.slice(0, 200) : null;
      await db.query(
        `update sms_message set status='sent', sent_at=now(), aligo_msg_id=$2, last_error=null where id=$1::uuid`,
        [id, aligoMsgId],
      );
    } else {
      const errMsg = (typeof payload?.error === "string" ? payload.error : "알 수 없는 오류").slice(0, 500);
      await db.query(
        `update sms_message
            set status = case when attempts < $2 then 'queued' else 'failed' end,
                next_attempt_at = case when attempts < $2 then now() + ($3 || ' minutes')::interval else next_attempt_at end,
                last_error = $4
          where id = $1::uuid`,
        [id, SMS_MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES, errMsg],
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
