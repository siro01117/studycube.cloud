import HydrationMarker from "./_shared/HydrationMarker";

// 공개 폼(/f/**) 전용 셸 — 껍데기만 추가하고 기존 화면 구조·스타일은 건드리지 않는다.
//
// 배경: 소개 사이트(studycube.co.kr)가 /f/* 는 이 앱으로 넘기면서 /_next/* 는 안 넘긴 적이
// 있었다. 그때 페이지 HTML 은 왔지만 안에서 참조하는 스크립트가 전부 404 라 하이드레이션이
// 안 됐고, 화면은 useIdentity 의 hydrated 이전 상태("확인 중…")에 영구히 멈췄다.
// 리라이트는 고쳤지만 그 시점에 HTML 을 캐시해 둔 기기는 계속 멈춘 채로 남는다 —
// 사용자에게 "캐시 지우세요"라고 안내할 수 없으니, 아래 인라인 스크립트가 스스로 복구한다.
//
// 정적 문자열만 사용(시각·난수·요청별 값 없음) — 서버 렌더와 항상 동일해서
// 하이드레이션 불일치를 새로 만들지 않는다.
const RECOVERY_SCRIPT = `
(function () {
  try {
    var RELOADED_KEY = "sc:reloaded";
    setTimeout(function () {
      if (window.__scHydrated === true) return; // 정상 하이드레이션 — 아무 것도 하지 않는다.

      var alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOADED_KEY) === "1";
      } catch (e) {
        // sessionStorage 접근 불가(프라이빗 모드 등) — 못 읽었으면 새로고침 시도 자체는 계속 진행.
      }

      if (alreadyReloaded) {
        try {
          var notice = document.createElement("div");
          notice.textContent = "화면을 불러오지 못했어요. 잠시 후 다시 시도하거나 카운터에 말씀해 주세요.";
          notice.style.cssText =
            "position:fixed;left:0;right:0;bottom:0;padding:14px 16px;" +
            "background:#111;color:#fff;font-size:13px;line-height:1.5;" +
            "text-align:center;z-index:2147483647;";
          document.body.appendChild(notice);
        } catch (e) {}
        return;
      }

      try {
        sessionStorage.setItem(RELOADED_KEY, "1");
      } catch (e) {
        // 표식을 못 남겨도 새로고침은 진행 — 이번 한 번은 그냥 재시도.
      }

      try {
        var url = new URL(window.location.href);
        url.searchParams.set("_r", String(Date.now())); // 캐시 우회, 기존 쿼리스트링은 보존.
        window.location.replace(url.toString());
      } catch (e) {}
    }, 6000);
  } catch (e) {}
})();
`;

export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- 외부 번들 의존 없는 짧은 정적 인라인 스크립트 */}
      <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
      <HydrationMarker />
      {children}
    </>
  );
}
