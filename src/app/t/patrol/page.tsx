import type { Viewport } from "next";
import MobilePatrol from "../../patrol/MobilePatrol";
import { loadPatrolData } from "../../patrol/loadPatrol";
import TabletNav from "../../_shared/TabletNav";

export const runtime = "nodejs";

// 태블릿 순찰 — 폰(/patrol)과 같은 화면(같은 컴포넌트·같은 서버 액션·같은 권한 검사)을 크기 모드만
// 바꿔 쓴다(nav=태블릿 상단탭, sheetMaxWidth=시트를 화면 끝까지 늘리지 않음). 순찰이 태블릿의 주 용도라
// 세 화면 중 기본 진입점이다.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default async function TabletPatrolPage() {
  const props = await loadPatrolData();
  return <MobilePatrol {...props} nav={<TabletNav key="nav" current="/t/patrol" />} sheetMaxWidth={620} />;
}
