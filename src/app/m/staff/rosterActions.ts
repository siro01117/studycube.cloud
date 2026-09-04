"use server";

// 직원 관리 "명단" 탭 서버 액션. 계정 생성·수정·삭제는 권한에 따라 갈린다:
//   account.provision 있음 → 바로 처리(초대 발급 / 정보 수정 / 퇴사 처리)
//   account.request 만 있음 → account-request.ts 로 신청만(승인 대기)
// 두 갈림이 화면에서 분명히 보이도록, 이 파일의 액션들은 결과에 { mode: "direct" | "requested" } 를
// 실어 돌려준다 — RosterView 가 그 값으로 "완료" 대 "승인 대기" 문구를 갈라 보여준다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe, can } from "@/lib/auth";
import { createInvite, revokeInvite, listInvites, type StaffInviteRow } from "@/lib/staff-invite";
import { requestAccountCreate, requestAccountEdit, requestAccountDelete, decideAccountRequest, listPendingAccountRequests, type AccountRequestRow } from "@/lib/account-request";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

export type RosterActionResult =
  | { ok: true; mode: "direct"; invite?: StaffInviteRow }
  | { ok: true; mode: "requested" }
  | { ok: false; error: string };

async function requireRosterAccess(): Promise<{ me: NonNullable<Awaited<ReturnType<typeof getMe>>>; canProvision: boolean; canRequest: boolean }> {
  const me = await getMe();
  if (!me) throw new Error("로그인이 필요합니다");
  const canProvision = can(me, "account.provision");
  const canRequest = can(me, "account.request");
  if (!canProvision && !canRequest) throw new Error("권한이 없습니다");
  return { me, canProvision, canRequest };
}

// 역할 선택지 — 전역 역할(branch_id null) + 이 지점 전용 역할.
export async function listAssignableRoles(): Promise<{ id: string; key: string; label: string }[]> {
  const { me } = await requireRosterAccess();
  const r = await db.query<{ id: string; key: string; label: string }>(
    `select id, key, label from role where branch_id is null or branch_id=$1 order by label`,
    [me.activeBranchId],
  );
  return r.rows;
}

export async function addStaff(formData: FormData): Promise<RosterActionResult> {
  const { me, canProvision, canRequest } = await requireRosterAccess();
  const name = s(formData.get("name"));
  const phone = s(formData.get("phone"));
  const title = s(formData.get("title"));
  const hiredAt = s(formData.get("hiredAt"));
  const roleId = s(formData.get("roleId"));
  if (!name) return { ok: false, error: "이름을 입력하세요." };

  try {
    if (canProvision) {
      const invite = await createInvite({ name, phone: phone ?? undefined, title: title ?? undefined, hiredAt: hiredAt ?? undefined, roleId: roleId ?? undefined });
      revalidatePath("/m/staff");
      return { ok: true, mode: "direct", invite };
    }
    if (canRequest) {
      const reason = s(formData.get("reason")) ?? "직원 추가";
      await requestAccountCreate({ branchId: me.activeBranchId, name, phone: phone ?? undefined, title: title ?? undefined, hiredAt: hiredAt ?? undefined, roleId: roleId ?? undefined, reason });
      revalidatePath("/m/staff");
      return { ok: true, mode: "requested" };
    }
    return { ok: false, error: "권한이 없습니다." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function editStaff(formData: FormData): Promise<RosterActionResult> {
  const { me, canProvision, canRequest } = await requireRosterAccess();
  const personId = s(formData.get("personId"));
  const name = s(formData.get("name"));
  const phone = s(formData.get("phone"));
  const title = s(formData.get("title"));
  const hiredAt = s(formData.get("hiredAt"));
  const roleId = s(formData.get("roleId"));
  if (!personId) return { ok: false, error: "대상을 찾을 수 없습니다." };

  try {
    if (canProvision) {
      await db.query(
        `update person set name=coalesce($2,name), phone=$3, title=$4, hired_at=$5 where id=$1`,
        [personId, name, phone, title, hiredAt],
      );
      // 이 화면은 직원당 역할 하나만 다룬다(운영상 필요해지면 다중 역할 UI를 별도로 늘린다) —
      // 이 지점 소속 역할을 지우고 선택된 역할(있으면)만 다시 넣는다.
      await db.query(`delete from person_role where person_id=$1 and branch_id=$2`, [personId, me.activeBranchId]);
      if (roleId) {
        await db.query(`insert into person_role(person_id, branch_id, role_id) values ($1,$2,$3) on conflict do nothing`, [personId, me.activeBranchId, roleId]);
      }
      revalidatePath("/m/staff");
      return { ok: true, mode: "direct" };
    }
    if (canRequest) {
      const reason = s(formData.get("reason")) ?? "정보 수정";
      await requestAccountEdit({ branchId: me.activeBranchId, targetPersonId: personId, name: name ?? undefined, phone: phone ?? undefined, title: title ?? undefined, hiredAt: hiredAt ?? undefined, roleId: roleId ?? undefined, reason });
      revalidatePath("/m/staff");
      return { ok: true, mode: "requested" };
    }
    return { ok: false, error: "권한이 없습니다." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function retireStaff(formData: FormData): Promise<RosterActionResult> {
  const { me, canProvision, canRequest } = await requireRosterAccess();
  const personId = s(formData.get("personId"));
  const leftAt = s(formData.get("leftAt"));
  if (!personId) return { ok: false, error: "대상을 찾을 수 없습니다." };

  try {
    if (canProvision) {
      await db.query(`update person set active=false, left_at=coalesce($2, current_date) where id=$1`, [personId, leftAt]);
      revalidatePath("/m/staff");
      return { ok: true, mode: "direct" };
    }
    if (canRequest) {
      const reason = s(formData.get("reason")) ?? "퇴사 처리";
      await requestAccountDelete({ branchId: me.activeBranchId, targetPersonId: personId, leftAt: leftAt ?? undefined, reason });
      revalidatePath("/m/staff");
      return { ok: true, mode: "requested" };
    }
    return { ok: false, error: "권한이 없습니다." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function revokeStaffInvite(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // 실제 권한(account.provision)은 revokeInvite 안에서도 한 번 더 본다. 여기서 먼저 거르는 것은
    // 이 파일의 다른 액션들과 같은 모양을 지키기 위해서다 — 아래층 guard 가 언젠가 옮겨지거나
    // 지워져도 이 층이 남아 막는다("use server" 함수는 하나하나가 인터넷에 열린 문이다).
    await requireRosterAccess();
    const id = s(formData.get("id"));
    if (!id) return { ok: false, error: "대상을 찾을 수 없습니다." };
    await revokeInvite(id);
    revalidatePath("/m/staff");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function listRosterInvites(): Promise<StaffInviteRow[]> {
  const { me } = await requireRosterAccess();
  if (!me.activeBranchId) return [];
  return listInvites(me, me.activeBranchId);
}

export async function listPendingRequests(): Promise<AccountRequestRow[]> {
  const { me } = await requireRosterAccess();
  return listPendingAccountRequests(me.activeBranchId ?? undefined);
}

export type DecideResult = { ok: true; invite?: StaffInviteRow } | { ok: false; error: string };

export async function decideRequest(formData: FormData): Promise<DecideResult> {
  try {
    // revokeStaffInvite 와 같은 이유로 이 층에서도 한 번 거른다(decideAccountRequest 안에도 guard 가 있다).
    await requireRosterAccess();
    const id = s(formData.get("id"));
    const decision = s(formData.get("decision"));
    const note = s(formData.get("note"));
    if (!id || (decision !== "approved" && decision !== "rejected")) return { ok: false, error: "요청이 올바르지 않습니다." };
    const outcome = await decideAccountRequest(id, decision, note ?? undefined);
    revalidatePath("/m/staff");
    return outcome.status === "approved" ? { ok: true, invite: outcome.invite } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}
