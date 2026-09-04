import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import PageHeader from "../../../_shared/PageHeader";
import Kiosk from "./Kiosk";

export const runtime = "nodejs";

// 카운터 데스크톱에 띄워두는 화면 — 표·격자가 아니라 QR 하나 + 남은 시간만 보이면 되므로
// 이 모듈의 폭 상한 규칙(표·격자에 적용) 대상이 아니다. 대신 화면 자체를 가운데 크게 하나만 둔다.
export default async function AttendanceKioskPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "staff_attendance.manage")) redirect("/m/staff");
  await ready();

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader backHref="/m/staff?section=attendance" backLabel="출근부" title="QR 출퇴근" flexNone />
      <Kiosk />
    </main>
  );
}
