import { redirect } from 'next/navigation';

// 루트 → 홈. 비로그인은 미들웨어가 /login 으로 보냄.
export default function Index() {
  redirect('/home');
}
