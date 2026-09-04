import type { Viewport } from "next";
import MobileSeat from "../../seat/MobileSeat";
import { loadSeatData } from "../../seat/loadSeat";
import TabletNav from "../../_shared/TabletNav";
import LiveRefresh from "../../_shared/LiveRefresh";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

// 태블릿 좌석 배치도 — 폰(/seat)과 같은 화면, 크기 모드만 다르다.
export default async function TabletSeatPage() {
  const props = await loadSeatData();
  return <><LiveRefresh intervalMs={30_000} /><MobileSeat {...props} nav={<TabletNav key="nav" current="/t/seat" />} sheetMaxWidth={560} /></>;
}
