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
background:#f6f7f9;color:#565d6e;font:20px -apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif">
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
  if (!device) return Response.json({ status: "error", message: "접근할 수 없습니다." }, { status: 401 });

  const payload = (await req.json().catch(() => null)) as { code?: unknown; kind?: unknown } | null;
  const code = typeof payload?.code === "string" ? payload.code : "";
  // kind 는 화면에서 학생이 고른 값 — 신뢰하지 않고 두 값 중 하나인지 여기서 좁힌다(그 외는
  // submitEntranceCode 가 다시 거른다). 자동 토글을 없앤 이유는 entrance.ts 함수 주석 참고.
  const kind = payload?.kind === "out" ? "out" : payload?.kind === "in" ? "in" : null;
  if (!kind) return Response.json({ status: "error", message: "다시 시도해주세요." });
  const result = await submitEntranceCode(deviceId, device.branchId, code, kind);
  return Response.json(result);
}

// ── 클라이언트 HTML+JS (React 없음, 외부 리소스 없음: 시스템 폰트 + 인라인 SVG만) ────────────
// 정적 문자열 — deviceId/token 을 이 안에 심지 않는다. 코드 제출 fetch 는 아래에서 보듯
// `location.pathname`(현재 주소를 브라우저가 이미 알고 있는 값)을 그대로 재사용한다 — 페이지
// 소스 어디에도 토큰이 리터럴로 나타나지 않는다(요구사항: "화면 소스에 토큰 평문이 노출되면 안 됨").
//
// 화면은 세 단계다: ① 입실/퇴실 고르기 → ② 코드 5자리 → ③ 결과. 예전에는 ①이 없이 마지막
// 기록의 반대로 자동 토글했는데, 학생이 자기가 무엇으로 찍히는지 누르기 전에 알 수 없었다.
// 색은 앱 테마(globals.css)의 밝은 팔레트를 그대로 가져왔다 — 입구에 세워둔 태블릿은 낮 동안
// 창가 조명 아래 있어 어두운 화면이 오히려 반사로 안 보인다.
const KIOSK_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>studycube 출입</title>
<style>
  /* 앱 테마(globals.css)와 같은 토큰 — 여기서만 쓰는 화면이라 값을 복사해 둔다(이 파일은 CSS 를
     불러오지 않는 독립 HTML 이다. globals.css 가 바뀌면 여기도 같이 손봐야 한다). */
  :root {
    color-scheme: light;
    --bg: #f6f7f9; --panel: #ffffff; --ink: #171a22; --sub: #565d6e; --line: #e4e6ee;
    --accent: #4f46e5; --accent-soft: #eef0ff;
    --in: #12b886; --in-soft: #e3f7f0;
    --out: #f59e0b; --out-soft: #fef3e2;
    --bad: #e5484d; --bad-soft: #fdecec;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; user-select: none; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .screen { position: fixed; inset: 0; display: none; flex-direction: column;
    align-items: center; justify-content: safe center; padding: 4vh 4vw; gap: 2vh; }
  .screen.show { display: flex; }

  .brand { color: var(--sub); font-size: clamp(15px, 2vw, 20px); letter-spacing: .02em; }
  /* 요구사항: 출입 문구가 너무 작았다 — 이 화면은 서서 1m 밖에서 읽는다. */
  .headline { font-size: clamp(30px, 5vw, 54px); font-weight: 800; letter-spacing: -.02em; text-align: center; }
  .sublead { font-size: clamp(16px, 2.4vw, 22px); color: var(--sub); text-align: center; }

  /* ① 입실/퇴실 고르기 */
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(14px, 2.4vw, 28px);
    width: min(92vw, 900px); margin-top: 2vh; }
  button.mode {
    appearance: none; border: 2px solid var(--line); border-radius: 24px; background: var(--panel);
    color: var(--ink); padding: clamp(20px, 4vh, 44px) 12px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: clamp(8px, 1.4vh, 16px);
    font-size: clamp(28px, 4.4vw, 48px); font-weight: 800; letter-spacing: -.02em;
    transition: transform 120ms, background 120ms, border-color 120ms;
  }
  button.mode svg { width: clamp(40px, 6vh, 64px); height: clamp(40px, 6vh, 64px); stroke-width: 1.8; }
  button.mode.in { color: var(--in); border-color: var(--in); }
  button.mode.in:active { background: var(--in-soft); transform: scale(.97); }
  button.mode.out { color: var(--out); border-color: var(--out); }
  button.mode.out:active { background: var(--out-soft); transform: scale(.97); }

  /* ② 키패드 */
  .modebadge { display: inline-flex; align-items: center; gap: 10px; padding: 8px 20px; border-radius: 999px;
    font-size: clamp(20px, 3vw, 30px); font-weight: 800; letter-spacing: -.01em; }
  .modebadge.in { color: var(--in); background: var(--in-soft); }
  .modebadge.out { color: var(--out); background: var(--out-soft); }
  .dots { display: flex; gap: clamp(10px, 2vw, 18px); margin: 1vh 0 2vh; }
  .dot { width: clamp(16px, 2.4vw, 22px); height: clamp(16px, 2.4vw, 22px); border-radius: 999px;
    background: var(--line); transition: background 120ms, transform 120ms; }
  .dot.on { background: var(--accent); transform: scale(1.15); }
  .pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: clamp(10px, 1.6vw, 18px);
    width: min(88vw, 62vh, 520px); }
  button.key {
    appearance: none; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--ink);
    font-size: clamp(26px, 3.6vw, 38px); font-weight: 700; letter-spacing: -.01em;
    min-height: 64px; height: clamp(64px, 9vh, 96px);
    display: flex; align-items: center; justify-content: center;
    transition: transform 120ms, background 120ms;
  }
  button.key:active { transform: scale(.97); background: var(--accent-soft); }
  button.key.ghost { background: transparent; border-color: transparent; color: var(--sub);
    font-size: clamp(15px, 2vw, 19px); font-weight: 600; }

  /* ③ 결과 */
  .result { gap: 1.4vh; background: var(--bg); z-index: 5; }
  .result .icon { width: clamp(72px, 12vh, 112px); height: clamp(72px, 12vh, 112px); }
  /* 이름은 이 화면에서 제일 커야 한다 — 학생이 확인해야 하는 단 하나의 값이다(요구사항). */
  .result .name { font-size: clamp(40px, 7vw, 76px); font-weight: 800; letter-spacing: -.03em; text-align: center; }
  .result .kind { font-size: clamp(24px, 4vw, 40px); font-weight: 800; }
  .result .kind.in { color: var(--in); }
  .result .kind.out { color: var(--out); }
  .result .time { font-size: clamp(20px, 2.8vw, 28px); color: var(--sub); font-variant-numeric: tabular-nums; }
  .result .msg { font-size: clamp(24px, 3.6vw, 38px); font-weight: 700; color: var(--bad); text-align: center; }
  .result .note { font-size: clamp(18px, 2.6vw, 26px); color: var(--sub); text-align: center; }

  .offline-banner { position: fixed; top: 0; left: 0; right: 0; padding: 12px; text-align: center;
    background: var(--bad); color: #fff; font-size: clamp(14px, 1.8vw, 17px); font-weight: 600;
    display: none; z-index: 10; }
  .offline-banner.show { display: block; }
  @media (orientation: portrait) {
    .pad { width: min(92vw, 56vh, 480px); }
    .modes { grid-template-columns: 1fr; width: min(92vw, 560px); }
  }
</style>
</head>
<body>
<div id="offline" class="offline-banner">네트워크 연결을 확인해주세요</div>

<div class="screen show" id="scMode">
  <div class="brand">studycube</div>
  <div class="headline">입실 · 퇴실을 선택하세요</div>
  <div class="modes">
    <button class="mode in" data-kind="in">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path></svg>
      입실
    </button>
    <button class="mode out" data-kind="out">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>
      퇴실
    </button>
  </div>
</div>

<div class="screen" id="scPad">
  <div class="modebadge" id="padBadge"></div>
  <div class="sublead">출입 코드 5자리를 누르세요</div>
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
    <button class="key ghost" id="back">← 처음으로</button>
    <button class="key" data-d="0">0</button>
    <button class="key ghost" id="clear">지우기</button>
  </div>
</div>

<div class="screen result" id="scResult">
  <svg class="icon" id="rIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></svg>
  <div class="name" id="rName"></div>
  <div class="kind" id="rKind"></div>
  <div class="time" id="rTime"></div>
  <div class="msg" id="rMsg"></div>
  <div class="note" id="rNote"></div>
</div>

<script>
(function () {
  "use strict";

  // 화면 꺼짐 방지 — 되면 켜고, 안 되면(구형 태블릿·비보안 컨텍스트) 조용히 무시한다. 탭이
  // 백그라운드로 갔다 돌아오면 잠금이 풀려 있을 수 있어 visibilitychange 때마다 다시 요청한다.
  var wakeLock = null;
  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (wl) { wakeLock = wl; }).catch(function () {});
  }
  requestWakeLock();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  var scMode = document.getElementById("scMode");
  var scPad = document.getElementById("scPad");
  var scResult = document.getElementById("scResult");
  var padBadge = document.getElementById("padBadge");
  var dots = document.querySelectorAll("#dots .dot");
  var offlineEl = document.getElementById("offline");
  var rIcon = document.getElementById("rIcon");
  var rName = document.getElementById("rName");
  var rKind = document.getElementById("rKind");
  var rTime = document.getElementById("rTime");
  var rMsg = document.getElementById("rMsg");
  var rNote = document.getElementById("rNote");

  var CHECK = '<circle cx="12" cy="12" r="10"></circle><path d="M8 12l2.5 2.5L16 9"></path>';
  var CROSS = '<circle cx="12" cy="12" r="10"></circle><path d="M9 9l6 6M15 9l-6 6"></path>';
  var INFO  = '<circle cx="12" cy="12" r="10"></circle><path d="M12 11v5"></path><path d="M12 7.5v.01"></path>';

  // 결과를 띄워두는 시간. 셋을 다르게 두는 이유(요구사항):
  //  - 오류는 읽을 게 한 줄뿐이고 학생은 코드를 다시 눌러야 하니 최대한 빨리 비켜준다.
  //  - 성공은 학생이 "내 이름이 맞나"를 확인해야 하는 화면이라 넉넉히 둔다.
  //  - 이미 처리됨은 이름 + 시각까지 읽어야 해서 성공보다 조금 더 준다.
  var HOLD_MS = { error: 1300, ok: 2800, already: 3400 };
  // 키패드에 코드를 누르다 만 채로 학생이 가버리면(줄이 밀리거나 마음이 바뀌어서) 다음 사람이
  // 남의 자릿수를 이어 누르게 된다 — 그래서 입력이 없으면 처음 화면으로 되돌린다.
  var IDLE_MS = 20000;

  var kind = null;   // "in" | "out" — ① 에서 고른 값
  var buf = "";
  var busy = false;
  var idleTimer = null;
  var holdTimer = null;

  function show(el) {
    scMode.className = "screen" + (el === scMode ? " show" : "");
    scPad.className = "screen" + (el === scPad ? " show" : "");
    scResult.className = "screen result" + (el === scResult ? " show" : "");
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { toMode(); }, IDLE_MS);
  }

  function toMode() {
    clearTimeout(idleTimer);
    kind = null; buf = ""; busy = false;
    renderDots();
    show(scMode);
  }

  function toPad(k) {
    kind = k;
    buf = ""; busy = false;
    renderDots();
    padBadge.className = "modebadge " + k;
    padBadge.textContent = k === "in" ? "입실" : "퇴실";
    show(scPad);
    armIdle();
  }

  function renderDots() {
    for (var i = 0; i < dots.length; i++) dots[i].className = "dot" + (i < buf.length ? " on" : "");
  }

  // 자동 제출: 5자리를 채우면 즉시 보낸다(확인 버튼 없음). 이 화면은 하루 수백 번 쓰는 "문을 여는"
  // 동작이라 탭이 한 번 더 늘면 줄이 밀린다. 잘못 누른 손해는 오류를 1.3초 보고 다시 누르는 것뿐.
  function onDigit(d) {
    if (busy || !kind) return;
    if (buf.length >= 5) return;
    buf += d;
    renderDots();
    armIdle();
    if (buf.length === 5) submit();
  }

  function submit() {
    busy = true;
    clearTimeout(idleTimer);
    // 소스에 토큰을 하드코딩하지 않는다 — 현재 주소(location.pathname)를 그대로 재사용하고,
    // 서버가 매 요청마다 그 안의 deviceId/token 을 다시 검증한다(route.ts POST 참고).
    fetch(location.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: buf, kind: kind }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        offlineEl.classList.remove("show");
        showResult(data || { status: "error", message: "다시 시도해주세요." });
      })
      .catch(function () {
        // 오프라인/네트워크 오류 — "됐다"고 보여주면 절대 안 된다. 명확히 오류로 표시한다.
        offlineEl.classList.add("show");
        showResult({ status: "error", message: "네트워크 오류 — 다시 시도해주세요." });
      });
  }

  function showResult(data) {
    var st = data.status;
    rName.textContent = ""; rKind.textContent = ""; rTime.textContent = "";
    rMsg.textContent = ""; rNote.textContent = "";

    if (st === "ok") {
      rIcon.innerHTML = CHECK;
      rIcon.style.color = data.kind === "in" ? "var(--in)" : "var(--out)";
      rName.textContent = data.name;
      rKind.className = "kind " + data.kind;
      rKind.textContent = data.kind === "in" ? "입실했습니다" : "퇴실했습니다";
      rTime.textContent = data.at;
    } else if (st === "already") {
      rIcon.innerHTML = INFO;
      rIcon.style.color = data.kind === "in" ? "var(--in)" : "var(--out)";
      rName.textContent = data.name;
      rKind.className = "kind " + data.kind;
      rKind.textContent = "이미 " + (data.kind === "in" ? "입실" : "퇴실") + " 처리되었습니다";
      rNote.textContent = data.at + "에 처리됨";
    } else {
      rIcon.innerHTML = CROSS;
      rIcon.style.color = "var(--bad)";
      rMsg.textContent = data.message || "코드를 확인해주세요.";
    }

    show(scResult);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      // 오류면 키패드로 돌아간다 — 대개 오타라서 고른 입실/퇴실은 그대로 두고 코드만 다시 누르면
      // 된다. 성공·이미처리면 이 학생의 볼일이 끝났으니 다음 사람을 위해 처음 화면으로 되돌린다.
      if (st === "error" && kind) { buf = ""; busy = false; renderDots(); show(scPad); armIdle(); }
      else toMode();
    }, HOLD_MS[st] || HOLD_MS.error);
  }

  document.querySelector(".modes").addEventListener("click", function (e) {
    var t = e.target.closest("button.mode");
    if (t) toPad(t.getAttribute("data-kind"));
  });

  document.getElementById("pad").addEventListener("click", function (e) {
    var t = e.target.closest("button");
    if (!t) return;
    if (t.id === "back") { toMode(); return; }
    if (t.id === "clear") { buf = ""; renderDots(); armIdle(); return; }
    var d = t.getAttribute("data-d");
    if (d != null) onDigit(d);
  });

  // 물리 키보드가 붙은 태블릿 대비(선택 입력 경로) — 키패드 화면에서만 반응한다.
  document.addEventListener("keydown", function (e) {
    if (!kind || busy) return;
    if (/^[0-9]$/.test(e.key)) onDigit(e.key);
    else if (e.key === "Backspace") { buf = ""; renderDots(); armIdle(); }
    else if (e.key === "Escape") toMode();
  });
})();
</script>
</body>
</html>`;
