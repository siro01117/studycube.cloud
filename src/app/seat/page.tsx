import type { Viewport } from "next";
import MobileSeat from "./MobileSeat";
import { loadSeatData } from "./loadSeat";

export const runtime = "nodejs";

// 캔버스 자체 핀치와 브라우저 확대가 싸우지 않게 이 화면만 잠근다(전역 설정은 그대로).
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// 폰용 좌석 배치도 — 풀스크린. 편집·툴바는 데스크톱(/m/seat)에 그대로 둔다.
// 쿼리·권한 검사는 loadSeat.ts 로 뺐다(태블릿 화면 /t/seat 과 공유 — 화면이 늘어도 검사가 갈리지 않게).
export default async function MobileSeatPage() {
  const props = await loadSeatData();
  return <MobileSeat {...props} />;
}
