import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 로그인 없이 접근 가능한 경로
const PUBLIC_PATHS = ['/login', '/signup'];

// 승인 대기 중인 유저가 접근 가능한 경로
const PENDING_PATHS = ['/pending', '/login'];

// 경로 → 최소 필요 역할 매핑
// admin: /admin, /manage, /portal, /student — 모두 접근 가능 (아래서 early return)
// manager: /manage, /portal
// 그 외(학생 등): /student, /portal
const ROLE_PATH_MAP: Record<string, string[]> = {
  manager: ['/manage', '/portal', '/schedule'],
};
const DEFAULT_PATHS = ['/student', '/portal', '/schedule'];

function isPublic(pathname: string)  { return PUBLIC_PATHS.some((p)  => pathname.startsWith(p)); }
function isPending(pathname: string) { return PENDING_PATHS.some((p) => pathname.startsWith(p)); }

// 쿠키 타입 (Supabase SSR 내부 타입이 export 안 되므로 인라인 정의)
interface CookieEntry { name: string; value: string; options?: Record<string, unknown>; }

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
        setAll(cookiesToSet: CookieEntry[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options ?? {})
          );
        },
      },
    }
  );

  // 세션 갱신 (항상 호출)
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // 1. 비로그인 상태 → public 경로 아니면 /login 으로
  if (!user && !isPublic(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2. 로그인 상태 → /login, /signup 접근 시 /portal 로
  if (user && isPublic(pathname)) {
    return NextResponse.redirect(new URL('/portal', request.url));
  }

  // 3. 로그인 상태 → 프로필 확인 (한 번의 DB 쿼리로 역할 + 승인상태 조회)
  if (user && !isPublic(pathname)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, approval_status')
      .eq('id', user.id)
      .single();

    // 3a. 승인 대기 중 → /pending 외 접근 차단
    if (profile?.approval_status === 'pending') {
      if (!isPending(pathname)) {
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

    // 3d. 역할별 접근 제어
    const allowedPaths = ROLE_PATH_MAP[role] ?? DEFAULT_PATHS;
    const allowed = allowedPaths.some((p) => pathname.startsWith(p));

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
