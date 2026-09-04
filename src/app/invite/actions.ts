"use server";

// 초대 코드 수락(비로그인) 서버 액션. 로그인 세션이 없는 상태에서 호출되므로 guard()를 쓰지 않는다 —
// staff-invite.ts 의 공개 함수(getInviteByCode/isLoginIdAvailable/redeemInvite)가 이미 안전하게
// 설계되어 있다(1회용 + 만료 + 코드 길이로 무차별 대입 방어).
import { redirect } from "next/navigation";
import { getInviteByCode, isLoginIdAvailable, redeemInvite, type InviteLookup } from "@/lib/staff-invite";
import { ready } from "@/lib/bootstrap";
import { normalizeLoginId } from "@/lib/hangul-romanize";

export async function lookupInvite(code: string): Promise<InviteLookup> {
  await ready();
  return getInviteByCode(code);
}

export async function checkLoginId(loginId: string): Promise<{ normalized: string; available: boolean }> {
  await ready();
  const normalized = normalizeLoginId(loginId);
  return { normalized, available: normalized ? await isLoginIdAvailable(normalized) : false };
}

export type SubmitState = { error?: string };

export async function submitInvite(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  await ready();
  const code = String(formData.get("code") ?? "");
  const loginId = String(formData.get("loginId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const pinConfirm = String(formData.get("pinConfirm") ?? "");
  const outcome = await redeemInvite(code, loginId, pin, pinConfirm);
  if (!outcome.ok) return { error: outcome.error };
  redirect("/login?welcome=1");
}
