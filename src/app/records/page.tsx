import type { Viewport } from "next";
import MobileRecords from "./MobileRecords";
import { loadRecordsData } from "./loadRecords";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 폰용 순찰 기록 — 세션별 학생 상태를 리스트로. 데스크톱(/m/patrol)은 그대로.
// 쿼리·권한 검사는 loadRecords.ts 로 뺐다(태블릿 화면 /t/records 와 공유).
export default async function MobileRecordsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const props = await loadRecordsData(sp.date);
  return <MobileRecords {...props} />;
}
