// 입구 태블릿 출입 키패드 — React/클라이언트 번들 없이 순수 HTML+바닐라 JS 로 직접 서빙한다.
// 이 화면은 나중에 APK 로 감싸질 무인 키오스크(하루 종일 켜둔 태블릿)라 가벼움이 곧 요구사항이다:
// App Router 페이지(page.tsx)를 쓰면 Next 가 React/RSC 런타임(수백KB)을 같이 내려보내지만, Route
// Handler 가 new Response(html, {headers:{content-type:'text/html'}}) 로 직접 문자열을 돌려주면
// React 가 전혀 로드되지 않는다 — 실측은 GET 응답 로그(콘솔 Content-Length)로 확인.
//
// 인증: URL 경로의 deviceId/token 을 매 요청(GET·POST 둘 다) 마다 verifyDevice() 로 검증한다(세션·
// 쿠키 없음 — 근거는 아래 client script 주석과 entrance.ts generateToken() 주석). 토큰이 없거나
// 틀리면 화면 자체가 뜨지 않는다(주소만으로 열리는 것을 막는다는 요구사항).
import { ready } from "@/lib/bootstrap";
import { verifyDevice, submitEntranceCode } from "@/lib/entrance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ deviceId: string; token: string }> };

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function deniedPage(): string {
  // 존재 여부·사유를 드러내지 않는다(잘못된 deviceId 인지 토큰인지 구분 안 되게) — access_attempt/
  // login_attempt 화면들과 같은 원칙.
  return `<!doctype html><meta charset="utf-8"><title>studycube</title>
<body style="margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;
background:#0b0c0f;color:#8a8f98;font:16px -apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif">
접근할 수 없습니다.</body>`;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  await ready();
  const { deviceId, token } = await ctx.params;
  const device = await verifyDevice(deviceId, token);
  if (!device) return html(deniedPage(), 401);
  return html(KIOSK_HTML);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  await ready();
  const { deviceId, token } = await ctx.params;
  const device = await verifyDevice(deviceId, token);
  if (!device) return Response.json({ ok: false, error: "접근할 수 없습니다." }, { status: 401 });

  const payload = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof payload?.code === "string" ? payload.code : "";
  const result = await submitEntranceCode(deviceId, device.branchId, code);
  return Response.json(result);
}

// ── 클라이언트 HTML+JS (React 없음, 외부 리소스 없음: 시스템 폰트 + 인라인 SVG만) ────────────
// 정적 문자열 — deviceId/token 을 이 안에 심지 않는다. 코드 제출 fetch 는 아래에서 보듯
// `location.pathname`(현재 주소를 브라우저가 이미 알고 있는 값)을 그대로 재사용한다 — 페이지
// 소스 어디에도 토큰이 리터럴로 나타나지 않는다(요구사항: "화면 소스에 토큰 평문이 노출되면 안 됨").
const KIOSK_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>studycube 출입</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; user-select: none; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #0b0c0f; color: #f5f6f8;
    font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  #app { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: safe center; padding: 4vh 4vw; }
  .brand { color: #6b7280; font-size: clamp(14px, 2vw, 18px); letter-spacing: -0.01em; margin-bottom: 1vh; }
  .dots { display: flex; gap: clamp(10px, 2vw, 18px); margin: 2vh 0 4vh; }
  .dot { width: clamp(14px, 2.2vw, 20px); height: clamp(14px, 2.2vw, 20px); border-radius: 999px; background: #2a2d34; transition: background 120ms, transform 120ms; }
  .dot.on { background: #4F46E5; transform: scale(1.15); }
  .pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: clamp(10px, 1.6vw, 18px); width: min(88vw, 62vh, 520px); }
  button.key {
    appearance: none; border: none; border-radius: 16px; background: #16181d; color: #f5f6f8;
    font-size: clamp(24px, 3.4vw, 34px); font-weight: 600; letter-spacing: -0.01em;
    min-height: 64px; height: clamp(64px, 9vh, 96px);
    display: flex; align-items: center; justify-content: center;
    transition: transform 120ms, background 120ms;
  }
  button.key:active { transform: scale(0.97); background: #1e2129; }
  button.key.ghost { background: transparent; color: #6b7280; font-size: clamp(15px, 2vw, 18px); font-weight: 400; }
  .result { position: fixed; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: safe center; gap: 2vh; background: #0b0c0f; z-index: 5; }
  .result.show { display: flex; }
  .result .icon { width: clamp(64px, 10vh, 96px); height: clamp(64px, 10vh, 96px); }
  .result .name { font-size: clamp(28px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; }
  .result .kind { font-size: clamp(20px, 3.4vw, 30px); font-weight: 600; }
  .result .kind.in { color: #34d399; }
  .result .kind.out { color: #f59e0b; }
  .result .time { font-size: clamp(15px, 2vw, 18px); color: #8a8f98; font-variant-numeric: tabular-nums; }
  .result.error .name { color: #f87171; font-size: clamp(22px, 3.6vw, 32px); }
  .offline-banner { position: fixed; top: 0; left: 0; right: 0; padding: 10px; text-align: center;
    background: #7c2d12; color: #fff; font-size: clamp(13px, 1.6vw, 15px); display: none; z-index: 10; }
  .offline-banner.show { display: block; }
  @media (orientation: portrait) { .pad { width: min(92vw, 56vh, 480px); } }
</style>
</head>
<body>
<div id="offline" class="offline-banner">네트워크 연결을 확인해주세요</div>
<div id="app">
  <div class="brand">studycube 출입</div>
  <div class="dots" id="dots">
    <span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>
  <div class="pad" id="pad">
    <button class="key" data-d="1">1</button>
    <button class="key" data-d="2">2</button>
    <button class="key" data-d="3">3</button>
    <button class="key" data-d="4">4</button>
    <button class="key" data-d="5">5</button>
    <button class="key" data-d="6">6</button>
    <button class="key" data-d="7">7</button>
    <button class="key" data-d="8">8</button>
    <button class="key" data-d="9">9</button>
    <button class="key ghost" id="clear">지우기</button>
    <button class="key" data-d="0">0</button>
    <span></span>
  </div>
</div>
<div class="result" id="result">
  <svg class="icon" id="resultIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></svg>
  <div class="name" id="resultName"></div>
  <div class="kind" id="resultKind"></div>
  <div class="time" id="resultTime"></div>
</div>
<script>
(function () {
  "use strict";

  // 화면 꺼짐 방지 — 되면 켜고, 안 되면(구형 태블릿·비보안 컨텍스트) 조용히 무시한다(요구사항:
  // "안 되면 조용히 무시, 에러 던지지 말 것"). 탭이 백그라운드로 갔다 돌아오면 잠금이 풀려 있을 수
  // 있어 visibilitychange 때마다 다시 요청한다.
  var wakeLock = null;
  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (wl) { wakeLock = wl; }).catch(function () {});
  }
  requestWakeLock();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  var dots = document.querySelectorAll("#dots .dot");
  var resultEl = document.getElementById("result");
  var resultIcon = document.getElementById("resultIcon");
  var resultName = document.getElementById("resultName");
  var resultKind = document.getElementById("resultKind");
  var resultTime = document.getElementById("resultTime");
  var offlineEl = document.getElementById("offline");

  var CHECK = '<circle cx="12" cy="12" r="10"></circle><path d="M8 12l2.5 2.5L16 9"></path>';
  var CROSS = '<circle cx="12" cy="12" r="10"></circle><path d="M9 9l6 6M15 9l9 6"></path>'.replace("M9 9l6 6M15 9l9 6", "M9 9l6 6M15 9l-6 6");

  var buf = "";
  var busy = false;

  function renderDots() {
    for (var i = 0; i < dots.length; i++) dots[i].className = "dot" + (i < buf.length ? " on" : "");
  }

  function resetBuf() { buf = ""; renderDots(); }

  // 자동 제출: 5자리를 채우면 즉시 서버로 보낸다(별도 확인 버튼 없음). 판단 근거 — 이 화면은
  // 하루 수백 번 쓰는 문을 여는 동작에 가깝다(디지털 도어락과 같은 UX 기대). 확인 버튼을 추가로
  // 요구하면 매 사용마다 한 번의 탭이 더 늘어 줄이 밀리고, 잘못 누른 경우의 손해는 "코드를
  // 확인해주세요"를 보고 5자리를 다시 누르는 것뿐이라 자동 제출보다 훨씬 크지 않다. 대신 실수
  // 눌림을 줄이기 위해 지우기 키를 항상 크게 두고, 결과 화면이 뜨는 동안(아래 showResult)에는
  // 입력을 받지 않아 "잘못 보고 있는 사이 다음 사람 코드가 섞이는" 사고를 막는다.
  function onDigit(d) {
    if (busy) return;
    if (buf.length >= 5) return;
    buf += d;
    renderDots();
    if (buf.length === 5) submit();
  }

  function submit() {
    busy = true;
    var code = buf;
    // 소스에 토큰을 하드코딩하지 않는다 — 현재 주소(location.pathname)를 그대로 재사용, 서버가
    // 매 요청마다 그 안의 deviceId/token 을 다시 검증한다(kiosk route.ts POST 참고).
    fetch(location.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        offlineEl.classList.remove("show");
        if (data && data.ok) {
          showResult(true, data.name, data.kind);
        } else {
          showResult(false, (data && data.error) || "코드를 확인해주세요.", null);
        }
      })
      .catch(function () {
        // 오프라인/네트워크 오류 — "됐다"고 보여주면 절대 안 된다(요구사항). 명확히 오류로 표시.
        offlineEl.classList.add("show");
        showResult(false, "네트워크 오류 — 다시 시도해주세요.", null);
      });
  }

  function showResult(ok, nameOrMsg, kind) {
    resultEl.className = "result show" + (ok ? "" : " error");
    resultIcon.innerHTML = ok ? CHECK : CROSS;
    resultIcon.style.color = ok ? (kind === "in" ? "#34d399" : "#f59e0b") : "#f87171";
    if (ok) {
      resultName.textContent = nameOrMsg;
      resultKind.textContent = kind === "in" ? "입실" : "퇴실";
      resultKind.className = "kind " + kind;
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, "0");
      var mm = String(now.getMinutes()).padStart(2, "0");
      resultTime.textContent = hh + ":" + mm;
    } else {
      resultName.textContent = nameOrMsg;
      resultKind.textContent = "";
      resultTime.textContent = "";
    }
    var holdMs = ok ? 2200 : 2600;
    setTimeout(function () {
      resultEl.className = "result";
      resetBuf();
      busy = false;
    }, holdMs);
  }

  document.getElementById("pad").addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.id === "clear") { resetBuf(); return; }
    var d = t.getAttribute("data-d");
    if (d != null) onDigit(d);
  });

  // 물리 키보드가 붙은 태블릿 대비(선택 입력 경로) — 숫자키만 반응.
  document.addEventListener("keydown", function (e) {
    if (/^[0-9]$/.test(e.key)) onDigit(e.key);
    else if (e.key === "Backspace") resetBuf();
  });
})();
</script>
</body>
</html>`;
