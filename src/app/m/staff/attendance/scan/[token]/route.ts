// QR 을 폰 카메라로 찍었을 때 실제로 열리는 경로. 쿠키를 써야 해서(로그인 전 스캔이면 펜딩 쿠키를
// 심는다) Server Component 페이지가 아니라 Route Handler로 둔다 — 페이지 렌더 중엔 cookies().set()이
// 금지돼 있다(Server Action/Route Handler에서만 허용).
import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { consumeQrToken, recordPunch, signPendingCookie, clientIp, PENDING_COOKIE } from "@/lib/staff-attendance";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  await ready();
  const { token } = await ctx.params;
  const origin = new URL(req.url).origin;
  const me = await getMe();
  const ip = await clientIp();

  const result = await consumeQrToken(token, me?.id ?? null, ip);
  if (!result.ok) {
    return NextResponse.redirect(`${origin}/m/staff/attendance/result?error=${result.reason}`);
  }

  if (!me) {
    // 로그인 안 된 상태 — 기본 카메라 앱이 여는 브라우저엔 세션이 없을 수 있다. QR 토큰은 이미
    // 위에서 소진했으므로(1회용), 로그인 완료 후엔 별도의 짧은 펜딩 쿠키로 이어붙인다. 어느 지점
    // QR 이었는지는 여기선 아직 판단할 수 없다(그 사람의 activeBranchId 를 로그인 전엔 모른다) —
    // continue 라우트가 로그인 완료 후 같은 검사를 한다.
    const res = NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/m/staff/attendance/continue")}`);
    res.cookies.set(PENDING_COOKIE, signPendingCookie(result.branchId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return res;
  }

  // 기록·조회 화면이 전부 me.activeBranchId 기준이므로(page.tsx, result 화면) 펀치도 반드시 그
  // 기준으로 남겨야 아무 화면에도 안 보이는 행이 생기지 않는다. QR 의 branchId 는 "물리적으로 어느
  // 카운터에서 찍었는지"의 증거일 뿐이라 두 값이 다르면(다른 지점 QR 을 찍음) 기록하지 않고 안내만
  // 한다 — 소속과 다른 지점 화면에 조용히 기록을 흘려보내는 것보다, 자기 지점 QR을 다시 찍으라고
  // 명확히 알리는 쪽이 안전하다(집주인 지시: 판단해서 근거와 함께 보고).
  if (!me.activeBranchId || result.branchId !== me.activeBranchId) {
    return NextResponse.redirect(`${origin}/m/staff/attendance/result?error=branch_mismatch`);
  }

  const punch = await recordPunch(me.activeBranchId, me.id, ip, "qr");
  return NextResponse.redirect(`${origin}/m/staff/attendance/result?kind=${punch.kind}`);
}
