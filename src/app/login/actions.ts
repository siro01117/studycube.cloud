"use server";
import { redirect } from "next/navigation";
import { authenticate, setSession } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  const remember = formData.get("remember") === "on";

  if (!loginId || !pin) return { error: "아이디와 PIN을 입력하세요." };

  const me = await authenticate(loginId, pin);
  if (!me) return { error: "아이디 또는 PIN이 올바르지 않습니다." };

  await setSession(me.id, remember);
  redirect("/home");
}
