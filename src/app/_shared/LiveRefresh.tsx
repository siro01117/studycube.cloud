"use client";

// 서버 데이터를 화면에 다시 끌어오는 공용 장치. 배포에서 "남이 바꾼 게 화면에 안 비친다"를 고치기
// 위한 것 — 여러 사람이 각자 기기에서 같은 지점을 보는데, 내가 한 조작은 서버액션의
// revalidatePath 로 즉시 반영되지만 남이 한 조작은 알 길이 없어 화면이 계속 옛날 상태였다.
//
// router.refresh() 는 서버 컴포넌트 트리만 다시 받아 갈아끼운다 — 클라이언트 컴포넌트의 state
// (입력 중인 글자, 열어둔 팝업, 스크롤)는 그대로 남는다. 그래서 근무자가 무언가 입력하는 도중에
// 갱신이 돌아도 쓰던 게 날아가지 않는다.
//
// 폴링 규율은 home/NowSection.tsx 선례를 그대로 따른다: 탭이 숨어 있으면 건너뛰고(보이지도 않는
// 화면 때문에 서버를 두드리지 않는다), 돌아오면 즉시 한 번 갱신하고, 실패는 조용히 무시한다
// (갱신 실패로 화면을 에러로 덮지 않는다 — 다음 주기에 어차피 다시 시도한다).
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** intervalMs 를 주면 그 주기로도 갱신한다. 안 주면 "탭으로 돌아왔을 때만" 갱신 — 이쪽이 기본이다.
 *  주기 폴링은 서버 호출을 계속 만들기 때문에 정말로 남이 실시간으로 바꾸는 화면(좌석 배치도 등)
 *  에만 붙이고, 나머지는 돌아왔을 때 한 번이면 충분하다. */
export default function LiveRefresh({ intervalMs }: { intervalMs?: number }) {
  const router = useRouter();
  // 갱신이 아직 안 끝났는데 다음 주기가 겹쳐 도는 것을 막는다(느린 회선의 태블릿에서 요청이
  // 쌓이는 것 방지). router.refresh() 는 완료를 알려주지 않으므로 시간으로 최소 간격만 지킨다.
  const lastRef = useRef(0);

  useEffect(() => {
    const MIN_GAP_MS = 3000;

    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = now;
      router.refresh();
    };

    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    // 같은 창 안에서 다른 앱을 보다 돌아오는 경우(태블릿·데스크톱 모두) visibilitychange 가 안 뜨는
    // 브라우저가 있어 focus 도 같이 듣는다. 위의 MIN_GAP_MS 가 둘이 겹쳐 도는 것을 막아준다.
    window.addEventListener("focus", onVisible);

    let timer: ReturnType<typeof setInterval> | null = null;
    if (intervalMs && intervalMs > 0) timer = setInterval(refresh, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [router, intervalMs]);

  return null;
}
