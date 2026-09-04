import type { Viewport } from "next";
import MobilePatrol from "./MobilePatrol";
import { loadPatrolData } from "./loadPatrol";

export const runtime = "nodejs";

// 이 화면 전용 뷰포트 — 브라우저 핀치줌 잠금(캔버스 자체 핀치와 충돌 방지, fixed 바 밀림 방지).
// 전역(layout.tsx)의 태블릿용 핀치 허용 설정은 그대로 둔다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// 모바일 순찰 — 풀스크린(NavRail 없음). 폰 북마크: studycube.cloud/patrol
// 쿼리·권한 검사는 loadPatrol.ts 로 뺐다(태블릿 화면 /t/patrol 과 공유).
export default async function MobilePatrolPage() {
  const props = await loadPatrolData();
  return <MobilePatrol {...props} />;
}
