import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

// 루트: 로그인돼 있으면 홈, 아니면 로그인으로
export default async function Index() {
  const me = await getMe();
  redirect(me ? "/home" : "/login");
}
