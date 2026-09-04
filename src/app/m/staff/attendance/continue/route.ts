// 로그인 전 QR 스캔 → 로그인 화면(next=이 경로)으로 갔다가 로그인이 끝나면 여기로 돌아와 자동으로
// 출퇴근을 이어 기록한다. 펜딩 쿠키를 읽고 반드시 지운다(성공이든 실패든) — 새로고침으로 두 번
// 처리되는 걸 막기 위해서다(예: 출근 처리 후 이 URL을 다시 열면 쿠키가 없어 그냥 근태 화면으로 간다).
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { recordPunch, verifyPendingCookie, clientIp, PENDING_COOKIE } from "@/lib/staff-attendance";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ready();
  const origin = new URL(req.url).origin;
  const me = await getMe();
  if (!me) {
    // 아직도 로그인이 안 됐다면(세션 만료 등) 다시 로그인으로.
    return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/m/staff/attendance/continue")}`);
  }

  const jar = await cookies();
  const raw = jar.get(PENDING_COOKIE)?.value;
  jar.delete(PENDING_COOKIE);
  const pending = raw ? verifyPendingCookie(raw) : null;
  if (!pending) {
    // 펜딩 쿠키가 없거나(직접 URL 접근) 만료됐다 — 조용히 근태 화면으로.
    return NextResponse.redirect(`${origin}/m/staff?section=attendance`);
  }

  // scan 라우트와 같은 규칙: 기록은 항상 me.activeBranchId 로 남긴다(조회 화면이 그 기준이므로).
  // 로그인 전에 스캔한 QR 의 지점이 로그인 후 확인된 소속 지점과 다르면(다른 지점 QR) 기록하지 않고
  // 안내한다 — scan/route.ts 상단 주석 참고.
  if (!me.activeBranchId || pending.branchId !== me.activeBranchId) {
    return NextResponse.redirect(`${origin}/m/staff/attendance/result?error=branch_mismatch`);
  }

  const ip = await clientIp();
  const punch = await recordPunch(me.activeBranchId, me.id, ip, "qr");
  return NextResponse.redirect(`${origin}/m/staff/attendance/result?kind=${punch.kind}`);
}
