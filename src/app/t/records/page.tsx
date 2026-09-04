import type { Viewport } from "next";
import MobileRecords from "../../records/MobileRecords";
import { loadRecordsData } from "../../records/loadRecords";
import TabletNav from "../../_shared/TabletNav";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 태블릿 순찰 기록 — "살짝 확인하는 정도"라 정정(기록 고치기)은 끈다(allowEdit=false).
// 정정이 필요하면 데스크톱(/m/patrol)에서 한다.
export default async function TabletRecordsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const props = await loadRecordsData(sp.date);
  return <MobileRecords {...props} nav={<TabletNav key="nav" current="/t/records" />} sheetMaxWidth={560} allowEdit={false} basePath="/t/records" />;
}
