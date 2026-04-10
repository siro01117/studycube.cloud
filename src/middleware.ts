import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 로그인 없이 접근 가능한 경로
const PUBLIC_PATHS = ['/login', '/signup'];

// 승인 대기 중인 유저가 접근 가능한 경로
const PENDING_PATHS = ['/pending', '/login'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: any) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: any) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 세션 갱신 (항상 호출)
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // 1. 비로그인 상태 → public 경로 아니면 /login 으로
  if (!user && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2. 로그인 상태 → /login, /signup 접근 시 /portal 로
  if (user && PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/portal', request.url));
  }

  // 3. 로그인 상태 → 프로필 확인
  if (user && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, approval_status')
      .eq('id', user.id)
      .single();

    // 3a. 승인 대기 중 → /pending 외 접근 차단
    if (profile?.approval_status === 'pending') {
      if (!PENDING_PATHS.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL('/pending', request.url));
      }
      return supabaseResponse;
    }

    // 3b. /pending 접근 but 승인됨 → /portal 로
    if (pathname.startsWith('/pending')) {
      return NextResponse.redirect(new URL('/portal', request.url));
    }

    // 3c. admin 은 모든 경로 접근 가능
    const role = profile?.role ?? 'user';
    if (role === 'admin') return supabaseResponse;

    // 3d. 역할별 접근 제어 — 역할 permissions 로 경로 허용 여부 판단
    // 현재는 단순히 /portal 은 모두 허용, /admin 은 admin 만 허용 (위에서 처리),
    // /manage 는 manager 이상, /student 는 user
    const managerPaths = ['/manage', '/portal'];
    const userPaths    = ['/student', '/portal'];

    let allowed = false;
    if (role === 'manager') {
      allowed = managerPaths.some((p) => pathname.startsWith(p));
    } else {
      // 기타 역할 (학생 등) — DB 역할의 permissions 로 판단하려면 추가 쿼리 필요
      // 현재는 /portal + /student 허용
      allowed = userPaths.some((p) => pathname.startsWith(p));
    }

    if (!allowed) {
      return NextResponse.redirect(new URL('/portal', request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
