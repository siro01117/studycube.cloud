import "server-only";

// 직원 계정 생성·수정·삭제 신청 — schedule_request(schedule-request.ts)와 같은 대기/승인/반려 패턴.
// 관리자(원내 공통)는 account.request 권한으로 신청만 하고, 승인·반려는 account.provision 권한
// (CTO 전용, is_cto bypass)만 할 수 있다.
//
// 2026-09-01(직원 관리 화면): create 승인은 더 이상 person 을 바로 만들지 않는다 — staff-invite.ts 의
// 초대 코드를 발급하고, 본인이 /invite/[code] 에서 아이디·비밀번호를 직접 정한다(임시 비밀번호 발급
// 흐름은 폐지). edit 신청도 새로 지원 — 정보 수정도 같은 갈림(직접 처리 vs 신청)을 타게 하기 위함.
import { db } from "./db";
import { guard } from "./auth";
import { issueInviteFromRequest, type StaffInviteRow } from "./staff-invite";

export type AccountRequestRow = {
  id: string;
  branch_id: string | null;
  req_type: "create" | "edit" | "delete";
  requested_by: string;
  target_person_id: string | null;
  login_id: string | null;
  name: string | null;
  phone: string | null;
  title: string | null;
  hired_at: string | null;
  left_at: string | null;
  role_id: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

/** 계정 생성 신청(초대 발급 신청) — 승인되면 초대 코드가 나가고, 본인이 아이디·비밀번호를 정한다. */
export async function requestAccountCreate(input: {
  branchId?: string | null;
  name: string;
  phone?: string;
  title?: string;
  hiredAt?: string;
  roleId?: string;
  reason: string;
}): Promise<{ id: string }> {
  const me = await guard("account.request");
  const name = input.name.trim();
  const reason = input.reason.trim();
  if (!name) throw new Error("이름을 입력하세요.");
  if (!reason) throw new Error("신청 사유를 입력하세요.");

  const r = await db.query<{ id: string }>(
    `insert into account_request(branch_id, req_type, requested_by, name, phone, title, hired_at, role_id, reason)
     values ($1,'create',$2,$3,$4,$5,$6,$7,$8) returning id`,
    [input.branchId ?? me.activeBranchId, me.id, name, input.phone?.trim() || null, input.title?.trim() || null, input.hiredAt || null, input.roleId || null, reason],
  );
  return { id: r.rows[0].id };
}

/** 재직 중인 직원의 정보 수정 신청. */
export async function requestAccountEdit(input: {
  branchId?: string | null;
  targetPersonId: string;
  name?: string;
  phone?: string;
  title?: string;
  hiredAt?: string;
  roleId?: string;
  reason: string;
}): Promise<{ id: string }> {
  const me = await guard("account.request");
  const reason = input.reason.trim();
  if (!input.targetPersonId) throw new Error("대상 직원을 선택하세요.");
  if (!reason) throw new Error("신청 사유를 입력하세요.");

  const r = await db.query<{ id: string }>(
    `insert into account_request(branch_id, req_type, requested_by, target_person_id, name, phone, title, hired_at, role_id, reason)
     values ($1,'edit',$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [input.branchId ?? me.activeBranchId, me.id, input.targetPersonId, input.name?.trim() || null, input.phone?.trim() || null, input.title?.trim() || null, input.hiredAt || null, input.roleId || null, reason],
  );
  return { id: r.rows[0].id };
}

/** 계정 삭제(퇴사 처리) 신청. */
export async function requestAccountDelete(input: {
  branchId?: string | null;
  targetPersonId: string;
  leftAt?: string;
  reason: string;
}): Promise<{ id: string }> {
  const me = await guard("account.request");
  const reason = input.reason.trim();
  if (!input.targetPersonId) throw new Error("대상 계정을 선택하세요.");
  if (!reason) throw new Error("신청 사유를 입력하세요.");

  const r = await db.query<{ id: string }>(
    `insert into account_request(branch_id, req_type, requested_by, target_person_id, left_at, reason)
     values ($1,'delete',$2,$3,$4,$5) returning id`,
    [input.branchId ?? me.activeBranchId, me.id, input.targetPersonId, input.leftAt || null, reason],
  );
  return { id: r.rows[0].id };
}

/** 대기 중인 신청 목록(branchId 를 주면 그 지점만, 아니면 전체 — CTO 승인 화면용). */
export async function listPendingAccountRequests(branchId?: string): Promise<AccountRequestRow[]> {
  await guard("account.request");
  const r = branchId
    ? await db.query<AccountRequestRow>(
        `select * from account_request where status='pending' and branch_id=$1 order by created_at`,
        [branchId],
      )
    : await db.query<AccountRequestRow>(
        `select * from account_request where status='pending' order by created_at`,
      );
  return r.rows;
}

export type DecideOutcome =
  | { status: "approved"; invite?: StaffInviteRow }
  | { status: "rejected" };

/** 신청 승인·반려.
 *  create 승인 → 초대 코드 발급(staff-invite.ts). person 은 아직 안 만든다.
 *  edit 승인   → target_person_id 의 정보(연락처·직함·입사일·이름·역할)를 신청된 값으로 갱신.
 *  delete 승인 → person.left_at 기록 + active=false (완전 삭제 아님 — 되돌릴 수 있고 FK 이력을 보존). */
export async function decideAccountRequest(
  id: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<DecideOutcome> {
  const me = await guard("account.provision");
  const r = await db.query<AccountRequestRow>(`select * from account_request where id=$1`, [id]);
  const row = r.rows[0];
  if (!row) throw new Error("신청을 찾을 수 없습니다.");
  if (row.status !== "pending") throw new Error("이미 처리된 신청입니다.");

  let invite: StaffInviteRow | undefined;
  if (decision === "approved") {
    if (row.req_type === "create") {
      invite = await issueInviteFromRequest(row, me.id, me.activeBranchId);
    } else if (row.req_type === "edit") {
      if (!row.target_person_id) throw new Error("대상 직원이 없습니다.");
      await db.query(
        `update person set
           name = coalesce($2, name), phone = coalesce($3, phone), title = coalesce($4, title), hired_at = coalesce($5, hired_at)
         where id=$1`,
        [row.target_person_id, row.name, row.phone, row.title, row.hired_at],
      );
      if (row.role_id) {
        await db.query(
          `insert into person_role(person_id, branch_id, role_id) values ($1,$2,$3) on conflict do nothing`,
          [row.target_person_id, row.branch_id, row.role_id],
        );
      }
    } else {
      if (!row.target_person_id) throw new Error("대상 계정이 없습니다.");
      await db.query(
        `update person set active=false, left_at=coalesce($2, current_date) where id=$1`,
        [row.target_person_id, row.left_at],
      );
    }
  }

  await db.query(
    `update account_request set status=$1, note=$2, decided_at=now(), decided_by=$3 where id=$4`,
    [decision, note?.trim() || null, me.id, id],
  );
  return decision === "approved" ? { status: "approved", invite } : { status: "rejected" };
}
