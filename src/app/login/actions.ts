"use server";
import { redirect } from "next/navigation";
import { authenticate, setSession } from "@/lib/auth";

export type LoginState = { error?: string };

// next 는 로그인 후 돌아갈 내부 경로만 허용한다(오픈 리다이렉트 방지) — 화이트리스트 방식: "/"로
// 시작, 두 번째 문자부터 영숫자·/·_·-·.·?·=·& 만 허용한다. "//"로 시작하는 것만 막던 예전 검사는
// "/\evil.com"(백슬래시)을 브라우저가 "//evil.com"으로 정규화해버리는 걸 놓쳤다 — 백슬래시·콜론·
// %인코딩이 전부 이 문자 집합 밖이라 애초에 걸러진다. 유효 경로 목록을 일일이 나열하는 대신(신규
// 라우트가 늘 때마다 깜빡 빠뜨릴 위험) 안전한 문자만 허용하는 화이트리스트를 골랐다 — 내부 라우트는
// 전부 이 문자 집합 안에 있고(예: /m/staff?section=attendance), 그 밖의 문자가 하나라도 섞이면
// 무조건 거부(기본값 "/home")하므로 새 우회 문자가 나와도 안전한 쪽으로 떨어진다.
const SAFE_NEXT_RE = /^\/[A-Za-z0-9][A-Za-z0-9/_.?=&-]*$/;
function safeNext(raw: string): string {
  return SAFE_NEXT_RE.test(raw) ? raw : "/home";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";
  const next = String(formData.get("next") ?? "");

  if (!loginId || !password) return { error: "아이디와 비밀번호를 입력하세요." };

  const result = await authenticate(loginId, password);
  if (!result.ok) {
    if (result.reason === "locked") {
      return { error: "너무 많이 틀렸습니다. 15분 후 다시 시도해주세요." };
    }
    return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }

  await setSession(result.me.id, remember);
  redirect(safeNext(next));
}
