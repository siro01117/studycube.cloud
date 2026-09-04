import LoginForm from "./LoginForm";

// next: 로그인 후 이어갈 내부 경로(QR 근태 등). 검증은 actions.ts loginAction 이 최종 관문(여긴
// 그냥 값을 그대로 폼에 실어 보낼 뿐 — 클라이언트를 신뢰하지 않는다는 이 레포의 원칙과 같다).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <LoginForm next={sp.next ?? null} />;
}
