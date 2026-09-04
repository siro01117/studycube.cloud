// 문자 발송 큐 — 웹앱이 문자를 보내려 할 때 부르는 유일한 자리.
//
// 이 파일은 알리고를 직접 부르지 않는다(부를 수도 없다 — API 키가 IP 화이트리스트에 묶여 있고
// Vercel 은 나가는 IP 가 고정이 아니다). 여기서 하는 일은 sms_message 테이블에 큐잉하는 것과,
// 큐잉 직후 발송기(scripts/sms-worker.mjs, 고정 공인 IP를 가진 VPS에서 도는 별개 프로세스)를
// "찌르는" 것뿐이다. 실제 발송은 발송기가 API 라우트(src/app/api/sms-worker/route.ts)로 큐를
// 가져가(claim) 처리한다 — 찌르기는 그 시점을 앞당길 뿐, 없어도(발송기가 꺼져 있어도) 큐잉 자체는
// 항상 성공해야 하고 발송기 쪽 5분 안전망이 결국 집어간다.
//
// 앞으로 접속코드 안내·수강만료·미납·공지 같은 화면이 문자를 보내려면 반드시 이 파일의
// enqueueSms()/enqueueSmsBatch() 를 부른다 — 각 화면이 직접 INSERT 하지 않는다(중복 방지·하루
// 상한을 한곳에서만 지키면 되게 하기 위함).
import "server-only";
import { db } from "./db";
import { todayKey } from "./date";

export const SMS_KINDS = [
  "test",             // QA 전용 — 발송기 배선 확인용. 관리 화면의 "테스트 발송 추가"만 이 kind 를 씀.
  "access_code",      // 수동 — 링크·로그인 코드 안내(학생 관리 화면)
  "notice_broadcast", // 수동 — 공지사항 문자 병행 발송
  "schedule_reminder",// 수동 — 등하원 스케쥴 미제출 독촉
  "attend_in",        // 자동(기본 꺼짐) — 입실 알림
  "attend_out",       // 자동(기본 꺼짐) — 퇴실 알림
  "expiry_reminder",  // 자동(기본 꺼짐) — 이용기간 만료 임박 안내(매일 정해진 시각에 그날 대상자 일괄)
  "expired",          // 자동(기본 꺼짐) — 이용기간 만료 안내(위와 같은 일괄 배치)
  "unpaid_reminder",  // 자리만 마련 — 아직 실제로 큐잉하는 곳 없음(이번 작업 범위 아님)
  "manual",           // 관리 화면에서 직접 입력해 보내는 임의 문자
] as const;
export type SmsKind = (typeof SMS_KINDS)[number];
export const isSmsKind = (v: string): v is SmsKind => (SMS_KINDS as readonly string[]).includes(v);

// 재시도 정책(scripts/sms-worker.mjs 가 이 상수를 그대로 따라 앱과 배선을 일치시킨다 — 값 자체는
// 여기 SMS_MAX_ATTEMPTS/RETRY_BACKOFF_MINUTES 가 출처, 워커는 자기 파일에 같은 값을 복사해 둔다.
// 워커는 별도 프로세스라 이 모듈을 import 할 수 없어서다 — README.md 에 두 곳을 같이 고치라고 적어둔다).
export const SMS_MAX_ATTEMPTS = 3;      // 최초 시도 포함 최대 3회 — 무한 재시도 방지.
export const RETRY_BACKOFF_MINUTES = 5; // 실패 후 다음 시도까지 최소 5분 — 알리고를 연타하지 않기 위함.

// 중복 방지 창. "같은 사람 + 같은 종류 + 같은 본문"이 이 시간 안에 또 들어오면 새로 쌓지 않는다.
// 사람이 실수로 버튼을 두 번 누르거나, 화면 코드가 같은 이벤트에 두 번 반응하는 흔한 버그를 막는
// 정도의 창이면 충분해서 10분으로 잡았다(같은 학생에게 하루 안에 정말 다른 이유로 같은 kind 의
// 문자가 다시 나가야 하는 합법적인 경우는 10분보다 훨씬 뒤에 벌어진다 — 예: 미납 안내를 다음날 또).
const DEDUP_WINDOW_MINUTES = 10;

// 하루 상한(지점당). 처음엔 200으로 잡았지만 입·퇴실 알림(attend_in/attend_out)이 생기면서 재계산이
// 필요해졌다 — 재원생 90명이 매일 1번씩만 입·퇴실해도 그것만으로 180건(90×2)이라 200은 여유가
// 거의 없다(공지 병행 발송·접속코드 안내처럼 전원 대상 수동 발송이 같은 날 한 번이라도 겹치면
// 바로 막힌다). 그래서 500으로 올린다 — 정상 사용 최댓값(입퇴실 180 + 이용기간 자동 배치 몇십 +
// 그날 수동 발송 90 안팎)에 넉넉한 여유를 두면서도, 버그로 같은 대상에게 반복 발송되는 사고(예:
// 루프가 안 멈춰 수천 건이 쌓이는 경우)는 여전히 확실히 막는다.
export const SMS_DAILY_CAP = 500;

// 자동 발송(kind: attend_in/attend_out/expiry_reminder/expired) 전용 하루 상한 — 위 전체 상한과
// 별개로 더 낮게 잡는다. 이유: 자동 발송은 사람이 누르는 게 아니라 조건(입퇴실·이용기간)만 되면
// 계속 나가므로, 코드 버그(예: 같은 이벤트를 여러 번 자동 처리)가 나면 사람이 버튼을 누르는 수동
// 발송보다 훨씬 빨리, 훨씬 조용히 쌓인다 — 사람이 실수를 알아챌 기회 자체가 없다. 400 으로 잡은
// 근거: 재원생 90명 기준 입·퇴실 정상 최댓값 180(90×2) + 이용기간 자동 배치(하루에 많아야 몇십
// 건) 를 넉넉히 덮으면서도, 전체 상한(500)과의 차(100)가 수동 발송(접속코드 안내·공지 병행발송
// 등, 학생 90명 규모)이 같은 날 자동 발송과 겹쳐도 막히지 않을 정도의 여유가 되게 했다. 지점 규모가
// 커지면(학생 수 증가) 이 값도 같이 올려야 한다.
export const AUTO_SMS_DAILY_CAP = 400;
export const AUTO_SMS_KINDS: readonly SmsKind[] = ["attend_in", "attend_out", "expiry_reminder", "expired"];

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; error: string; reason: "invalid" | "duplicate" | "daily_cap" };

// 한국 휴대폰 번호 형식만 느슨하게 검사(하이픈 유무 무관, 010/011 등). 형식 검증이 목적이지 통신사
// 판별이 목적이 아니라 범위를 넓게 잡는다.
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;

type EnqueueParams = {
  branchId: string;
  phone: string;
  body: string;
  kind: SmsKind;
  studentId?: string | null;
  requestedBy?: string | null;
};

// 큐에 한 건 넣는다(검증·중복 방지·하루 상한 포함) — 발송기를 찌르지는 않는다. 찌르기는 호출부
// (enqueueSms/enqueueSmsBatch)가 "이번 호출로 몇 건이 들어갔는지"를 다 안 뒤에 한 번만 하기 위해
// 여기서는 하지 않는다.
async function insertOne(params: EnqueueParams): Promise<EnqueueResult> {
  const phone = params.phone.trim();
  const body = params.body.trim();
  if (!PHONE_RE.test(phone)) return { ok: false, error: "전화번호 형식이 올바르지 않습니다.", reason: "invalid" };
  if (!body) return { ok: false, error: "내용을 입력하세요.", reason: "invalid" };
  if (body.length > 2000) return { ok: false, error: "내용이 너무 깁니다.", reason: "invalid" };
  if (!isSmsKind(params.kind)) return { ok: false, error: "알 수 없는 종류입니다.", reason: "invalid" };

  // 중복 방지: 같은 지점·번호·종류·본문이 창 안에 이미 있으면(대기 중이든 이미 보냈든) 새로 쌓지 않는다.
  const dupR = await db.query(
    `select 1 from sms_message
      where branch_id = $1::uuid and phone = $2 and kind = $3 and body = $4
        and requested_at > now() - ($5 || ' minutes')::interval
      limit 1`,
    [params.branchId, phone, params.kind, body, DEDUP_WINDOW_MINUTES],
  );
  if (dupR.rows.length > 0) {
    return { ok: false, error: "같은 내용을 방금 같은 번호로 보냈습니다(중복 방지).", reason: "duplicate" };
  }

  // 하루 상한: KST 기준 오늘 날짜로 그 지점의 오늘 요청 건수를 센다.
  const today = todayKey();
  const capR = await db.query<{ n: string }>(
    `select count(*)::text as n from sms_message
      where branch_id = $1::uuid and (requested_at at time zone 'Asia/Seoul')::date = $2::date`,
    [params.branchId, today],
  );
  const countToday = Number(capR.rows[0]?.n ?? "0");
  if (countToday >= SMS_DAILY_CAP) {
    return { ok: false, error: `오늘 발송 상한(${SMS_DAILY_CAP}건)에 도달했습니다.`, reason: "daily_cap" };
  }

  // 자동 발송(kind 가 AUTO_SMS_KINDS 에 속함) 전용 하루 상한 — 전체 상한과 별개로 한 번 더 센다
  // (위 근거는 AUTO_SMS_DAILY_CAP 선언부 주석 참고). insertOne 이 유일한 삽입 지점이라 여기서 막으면
  // 자동 발송 호출부(attendanceActions.ts/patrolActions.ts/sms-auto.ts)가 각자 상한을 다시 구현할
  // 필요가 없다.
  if (AUTO_SMS_KINDS.includes(params.kind)) {
    const autoCapR = await db.query<{ n: string }>(
      `select count(*)::text as n from sms_message
        where branch_id = $1::uuid and kind = any($2::text[])
          and (requested_at at time zone 'Asia/Seoul')::date = $3::date`,
      [params.branchId, AUTO_SMS_KINDS, today],
    );
    const autoCountToday = Number(autoCapR.rows[0]?.n ?? "0");
    if (autoCountToday >= AUTO_SMS_DAILY_CAP) {
      return { ok: false, error: `오늘 자동 발송 상한(${AUTO_SMS_DAILY_CAP}건)에 도달했습니다.`, reason: "daily_cap" };
    }
  }

  const r = await db.query<{ id: string }>(
    `insert into sms_message(branch_id, student_id, phone, body, kind, requested_by)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
     returning id`,
    [params.branchId, params.studentId ?? null, phone, body, params.kind, params.requestedBy ?? null],
  );
  return { ok: true, id: r.rows[0]!.id };
}

// 발송기(scripts/sms-worker.mjs)를 "찌른다" — 큐에 새로 넣은 게 있으니 5분 안전망을 기다리지 말고
// 지금 바로 집어가라는 신호만 보낸다. 전화번호·문자 본문은 절대 싣지 않는다(발송기는 어차피
// /api/sms-worker 의 claim 으로 큐에서 직접 읽어간다 — 이 경로로 개인정보가 한 번 더 지나갈
// 이유가 없다).
//
// SMS_WORKER_URL 이 비어 있으면(발송기용 VPS 가 아직 없거나 로컬 개발 중) 조용히 아무것도 하지
// 않는다 — 큐잉은 발송기 유무와 무관하게 항상 성공해야 하므로 이게 기본값이어야 정상이다.
//
// 타임아웃 1.5초: 발송기는 신호만 받으면 실제 처리는 뒤로 미루고 바로 202 를 돌려주도록 만들어져
// 있어(scripts/sms-worker.mjs 참고) 정상 경로는 수십~수백ms 안에 끝난다. 1.5초는 그보다 넉넉히
// 위이면서도, 발송기가 응답이 없을 때(재부팅 등) 이 요청을 부른 화면(결제·공지 등 본 작업)이
// 오래 붙잡히지 않게 하는 상한이다. 실패는 무엇이든(타임아웃 포함) 조용히 삼키고 로그만 남긴다 —
// 문자를 못 찌른 것 때문에 본 작업이 실패해선 안 된다.
const NUDGE_TIMEOUT_MS = 1500;

// 공유 비밀은 SMS_WORKER_SECRET 을 그대로 재사용한다(별도 비밀을 새로 두지 않음) — 찌르기도
// claim/report 와 마찬가지로 "웹앱 ↔ 발송기" 둘만 주고받는 통로이고 신뢰 경계가 같아서, 시크릿을
// 하나 더 만들어 관리하는 비용을 들일 이유가 없다.
//
// await 하는 이유(순수 fire-and-forget 이 아닌 이유): Vercel 서버리스 함수는 응답을 돌려준 뒤
// 프로세스가 언제든 멈출 수 있어, await 없이 던져놓은 fetch 는 응답 시점에 따라 끝까지 못 갈 수
// 있다. 그래서 최대 1.5초까지는 기다리되, 그 이상은 절대 기다리지 않도록 타임아웃으로 상한을 둔다.
async function nudgeSmsWorker(): Promise<void> {
  const url = process.env.SMS_WORKER_URL;
  if (!url) return;
  const secret = process.env.SMS_WORKER_SECRET || "dev-only-sms-worker-secret";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NUDGE_TIMEOUT_MS);
  try {
    await fetch(`${url.replace(/\/+$/, "")}/nudge`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
  } catch (err) {
    // 전화번호·본문·시크릿 값은 로그에 남기지 않는다 — 실패 사실과 사유 이름만. 큐잉 자체는 이미
    // 끝났으므로 여기서 던지지 않는다 — 호출부(본 작업)를 실패시키지 않는다.
    console.error("[sms] 발송기 찌르기 실패(안전망이 대신 집어감):", err instanceof Error ? err.name : String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function enqueueSms(params: EnqueueParams): Promise<EnqueueResult> {
  const result = await insertOne(params);
  if (result.ok) await nudgeSmsWorker();
  return result;
}

// 여러 건을 한 번에 큐잉할 때 쓴다(예: 공지사항 문자 병행 발송 — 대상 학생 수만큼 반복). 건마다
// enqueueSms() 를 부르면 건마다 발송기를 찌르게 되어, 대상이 90명이면 찌르기도 90번 나간다 —
// 발송기는 한 번만 찔러도 그 시점에 큐 전체(claim 배치 20건씩, 이번 패스에서 못 다 집으면
// "끝나면 한 번 더"로 이어서)를 처리하므로 낭비다. 그래서 여기서는 insertOne() 을 반복하고,
// 한 건이라도 성공했으면 전체 배치가 끝난 뒤 딱 한 번만 찌른다.
export async function enqueueSmsBatch(items: EnqueueParams[]): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = [];
  let anyOk = false;
  for (const item of items) {
    const result = await insertOne(item);
    results.push(result);
    if (result.ok) anyOk = true;
  }
  if (anyOk) await nudgeSmsWorker();
  return results;
}
