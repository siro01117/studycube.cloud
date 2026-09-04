#!/usr/bin/env node
// 문자 발송기 — 알리고 API 키가 IP 화이트리스트에 묶여 있어서, 등록된 고정 IP 를 가진 기기(원내
// 공유기 뒤가 아니라 고정 공인 IP를 가진 VPS)에서만 돌 수 있는 별개 스크립트다(Next 앱과 같은
// 저장소에 있지만 같은 프로세스로 돌지 않는다, Vercel 서버리스에는 절대 배포되지 않는다). 실행
// 방법·환경변수는 README.md 참고.
//
// 동작: 웹앱의 /api/sms-worker 를 공유 비밀로 불러 큐를 가져가고(claim), 알리고에 실제로 보낸 뒤
// 결과를 되돌려 준다(report). 예전에는 이 스크립트가 "한 번 실행 = 한 번 처리하고 종료"였고 OS
// 스케줄러가 짧은 간격(20초~1분)으로 계속 불러 줘야 했다 — 그 전제는 "발송기가 학원 공유기 뒤에
// 있어 웹앱이 먼저 부를 수 없다"였다. 이제 발송기가 고정 공인 IP를 가진 VPS 에 있어 웹앱이 직접
// 부를 수 있으므로, 이 스크립트는 **계속 떠 있는 서버**가 되어(1) 웹앱이 큐에 넣을 때마다 보내는
// "찌르기"를 받으면 즉시 큐를 처리하고, (2) 그 찌르기가 실패하거나 유실돼도(VPS 재부팅, 순간
// 단절) 놓치지 않도록 5분 간격의 느린 안전망도 같이 돈다. 큐 자체(원자적 선점·재시도·백오프)는
// 그대로다 — 바뀐 건 "언제 집어가는지 아는 방법"뿐이다.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const BASE_URL = (process.env.STUDYCUBE_API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const WORKER_SECRET = process.env.SMS_WORKER_SECRET || "dev-only-sms-worker-secret"; // 웹앱 route.ts 의 로컬 폴백과 반드시 같은 값
// 웹앱의 "찌르기"를 받는 이 발송기 자신의 수신 포트. 8787을 기본값으로 잡은 이유: 22(SSH)·80/443
// (웹)·3000(Next 개발 서버) 같은 흔히 쓰는 포트와 겹치지 않는 1024 이상의 비특권 포트이면서,
// 오라클 클라우드 등 무료 VPS 방화벽 기본 규칙에 걸리지 않는 값이 필요했다 — 임의의 높은 포트
// 하나만 정해두면 되므로 8787로 고정하고 환경변수로 바꿀 수 있게 열어둔다.
const WORKER_PORT = Number(process.env.SMS_WORKER_PORT) || 8787;
const ALIGO_API_KEY = process.env.ALIGO_API_KEY || "";
const ALIGO_USER_ID = process.env.ALIGO_USER_ID || "";
const ALIGO_SENDER = process.env.ALIGO_SENDER || "";
// 기본값은 반드시 테스트 모드(Y) — 사람이 명시적으로 ALIGO_SEND_LIVE=true 를 줄 때만 실제 발송.
// 알리고는 testmode_yn=Y 면 실제로 보내지 않고 형식만 검사해 준다(과금 없음).
const LIVE = process.env.ALIGO_SEND_LIVE === "true";
const BATCH_LIMIT = 20;
// 느린 안전망 주기. 찌르기가 정상 도착하면 이 타이머는 사실상 아무것도 할 일이 없다(claim 결과가
// 0건) — 그래서 짧게 잡을 이유가 없다. 5분은 "찌르기가 실패한 최악의 경우 사람이 눈치채기 전에
// 회복되는" 정도의 여유이면서, 예전 20초 간격(하루 4,320회 호출) 대비 하루 288회로 줄여 평소엔
// 거의 항상 빈 손으로 끝나는 호출을 최소화한다.
const SAFETY_NET_MS = 5 * 60 * 1000;

if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
  console.warn("[sms-worker] ALIGO_API_KEY/ALIGO_USER_ID/ALIGO_SENDER 중 비어있는 값이 있습니다 — 알리고 호출은 형식 오류로 실패합니다.");
}

// 로그에 번호 전체를 남기지 않는다(개인정보) — 앞 3자리·뒤 4자리만 남기고 가운데를 가린다.
function maskPhone(phone) {
  const digits = String(phone).replace(/[^0-9]/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

async function claim() {
  const res = await fetch(`${BASE_URL}/api/sms-worker`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WORKER_SECRET}` },
    body: JSON.stringify({ action: "claim", limit: BATCH_LIMIT }),
  });
  if (!res.ok) throw new Error(`claim 실패: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`claim 실패: ${data.error || "unknown"}`);
  return data.items || [];
}

async function report(id, result) {
  const res = await fetch(`${BASE_URL}/api/sms-worker`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WORKER_SECRET}` },
    body: JSON.stringify({ action: "report", id, ...result }),
  });
  if (!res.ok) console.error(`[sms-worker] report 실패(id=${id}): HTTP ${res.status}`);
}

// 알리고 발송 규격: https://apis.aligo.in/send/ — key, user_id, sender(사전 등록된 발신번호),
// receiver, msg. 응답은 result_code(1=성공, 그 외=오류) + message.
async function sendAligo(item) {
  const form = new URLSearchParams({
    key: ALIGO_API_KEY,
    user_id: ALIGO_USER_ID,
    sender: ALIGO_SENDER,
    receiver: item.phone,
    msg: item.body,
    testmode_yn: LIVE ? "N" : "Y",
  });
  const res = await fetch("https://apis.aligo.in/send/", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!data) return { ok: false, error: `응답 파싱 실패(HTTP ${res.status})` };
  // 알리고는 성공을 result_code:1(숫자 또는 문자열)로 준다. 그 외(예: -101 IP 인증오류)는 실패.
  const code = String(data.result_code ?? "");
  if (code === "1") {
    return { ok: true, aligoMsgId: data.msg_id != null ? String(data.msg_id) : null };
  }
  return { ok: false, error: `${code} ${data.message || ""}`.trim() };
}

// 한 번의 "집을 수 있는 만큼 처리" 패스. claim 이 빈 배열을 주면 조용히 끝난다(안전망이 대부분의
// 실행에서 이 경로를 탄다 — 찌르기가 이미 다 처리해 놓았을 것이므로).
async function runOnce() {
  const items = await claim();
  if (items.length === 0) return 0;
  console.log(`[sms-worker] ${items.length}건 선점`);
  for (const item of items) {
    try {
      const result = await sendAligo(item);
      await report(item.id, result);
      if (result.ok) {
        console.log(`[sms-worker] 성공 ${maskPhone(item.phone)} (${item.kind}) msg_id=${result.aligoMsgId ?? "-"}`);
      } else {
        console.warn(`[sms-worker] 실패 ${maskPhone(item.phone)} (${item.kind}, 시도 ${item.attempts}/3): ${result.error}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sms-worker] 예외 ${maskPhone(item.phone)}: ${message}`);
      await report(item.id, { ok: false, error: `worker 예외: ${message}`.slice(0, 500) });
    }
  }
  return items.length;
}

// 동시 실행 방지: 찌르기 여러 개가 겹쳐 오거나(웹앱이 짧은 시간에 여러 건을 큐잉) 찌르기와 안전망
// 타이머가 동시에 울려도 claim 을 두 번 겹쳐 돌리지 않는다 — 같은 건을 두 발송기 "패스"가 동시에
// 집으려 다투는 걸 막는다(참고: DB 쪽 for update skip locked 도 안전장치지만, 그와 별개로 발송기
// 프로세스 자신도 겹쳐 돌 이유가 없다). 처리 중에 또 신호가 오면 무시하지 않고 "끝나면 한 번 더"로
// 접어서, 처리 중 새로 큐잉된 건이 이번 패스에서 빠졌더라도 다음 패스에서 바로 잡힌다.
let running = false;
let rerunRequested = false;

async function processQueue(reason) {
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;
  try {
    do {
      rerunRequested = false;
      try {
        await runOnce();
      } catch (err) {
        console.error(`[sms-worker] 처리 오류(${reason}):`, err instanceof Error ? err.message : err);
      }
    } while (rerunRequested);
  } finally {
    running = false;
  }
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// 웹앱의 "찌르기" 수신 통로. 본문은 신호일 뿐이라 읽지 않는다(전화번호·문자 본문은 이 경로를 타지
// 않는다 — 발송기는 어차피 claim 으로 큐에서 직접 집어간다). 응답은 큐 처리를 기다리지 않고 바로
// 돌려준다(웹앱 쪽 요청을 붙잡지 않기 위해) — 실제 처리는 응답 뒤 백그라운드에서 이어간다.
const server = createServer((req, res) => {
  req.resume(); // 바디가 오더라도 흘려보내고 무시
  if (req.method !== "POST" || req.url !== "/nudge") {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }
  const auth = req.headers["authorization"] || "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqualStr(got, WORKER_SECRET)) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }
  res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  processQueue("nudge");
});

server.on("error", (err) => {
  console.error("[sms-worker] 수신 서버 오류:", err instanceof Error ? err.message : err);
});

server.listen(WORKER_PORT, () => {
  console.log(`[sms-worker] 시작 (${LIVE ? "실발송" : "테스트모드"}, base=${BASE_URL}, 수신 포트=${WORKER_PORT}, 안전망=${SAFETY_NET_MS / 60000}분)`);
  // 시작할 때 한 번은 즉시 처리 — 꺼져 있던 동안 쌓인 큐가 있을 수 있다.
  processQueue("startup");
  setInterval(() => processQueue("safety-net"), SAFETY_NET_MS);
});
