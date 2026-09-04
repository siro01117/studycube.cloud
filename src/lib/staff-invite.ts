import "server-only";
import { pinProblem } from "./credential";

// 직원 초대 코드 — "직원 추가"(account.provision 직접 처리, 또는 account_request 승인)의 결과물.
// 이 시점엔 아직 로그인 계정(person)이 없다 — 초대받은 사람이 /invite/[code] 에서 아이디·비밀번호를
// 직접 정해야 person 행이 생긴다(person.login_id/pin_hash 는 not null이라 그 전엔 만들 수 없다).
//
// 코드 형식·보안 근거(보고용):
//   32자 커스텀 알파벳(0/O/1/I/L 제외, 사람이 손으로 옮겨 적어도 헷갈리지 않게) 중 10자 =
//   32^10 ≈ 2^50(약 1100조) 가지 — 유효기간 7일 안에 초당 1000회를 시도해도 기대 시도 횟수의
//   0.0000001% 도 못 돈다. login_attempt 류의 잠금 테이블을 따로 두지 않고 "길이"만으로 방어한다
//   (학생 access_code처럼 사람이 외워서 치는 짧은 코드가 아니라, 링크로 전달되는 1회용 토큰이라
//   짧을 이유가 없다).
//   유효기간은 7일 — 새 직원이 코드를 전달받아 실제로 계정을 만들기까지(대면 전달·이직 절차 등)
//   여유를 주면서도, 방치된 초대가 무한정 유효하지 않게 하는 통상적인 초대 링크 관행.
import { db } from "./db";
import { guard, can, type Me } from "./auth";
import { normalizeLoginId } from "./hangul-romanize";
import { hashPin } from "./hash";
import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32자, 0/O/1/I/L 제외
const CODE_LEN = 10;
export const INVITE_TTL_DAYS = 7;

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    const dup = await db.query(`select 1 from staff_invite where code=$1`, [code]);
    if (dup.rows.length === 0) return code;
  }
  throw new Error("초대 코드 생성에 실패했습니다. 다시 시도해주세요.");
}

export type StaffInviteRow = {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  phone: string | null;
  title: string | null;
  hired_at: string | null;
  role_id: string | null;
  status: "pending" | "used" | "revoked";
  account_request_id: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_person_id: string | null;
};

export type InviteStatus = "pending" | "used" | "revoked" | "expired";

export function inviteStatus(row: StaffInviteRow, now = new Date()): InviteStatus {
  if (row.status !== "pending") return row.status;
  return new Date(row.expires_at) < now ? "expired" : "pending";
}

type NewInviteInput = {
  branchId: string;
  name: string;
  phone?: string | null;
  title?: string | null;
  hiredAt?: string | null;
  roleId?: string | null;
  createdBy: string; // person.id — 직접 처리든 신청 승인이든 "지금 만든 사람"
  accountRequestId?: string | null;
};

/** 초대 행 생성(내부 공용 — 가드는 호출부 책임: 직접 처리는 account.provision, 신청 승인 경로는
 *  decideAccountRequest 가 이미 account.provision 을 확인한 뒤 호출한다). */
async function insertInvite(input: NewInviteInput): Promise<StaffInviteRow> {
  const name = input.name.trim();
  if (!name) throw new Error("이름을 입력하세요.");
  const code = await uniqueCode();
  const r = await db.query<StaffInviteRow>(
    `insert into staff_invite(branch_id, code, name, phone, title, hired_at, role_id, created_by, expires_at, account_request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '${INVITE_TTL_DAYS} days', $9)
     returning *`,
    [input.branchId, code, name, input.phone?.trim() || null, input.title?.trim() || null, input.hiredAt || null, input.roleId || null, input.createdBy, input.accountRequestId ?? null],
  );
  return r.rows[0];
}

/** account.provision 보유자가 직접 발급하는 초대(승인 대기 없이 즉시). */
export async function createInvite(input: {
  name: string;
  phone?: string;
  title?: string;
  hiredAt?: string;
  roleId?: string;
}): Promise<StaffInviteRow> {
  const me = await guard("account.provision");
  if (!me.activeBranchId) throw new Error("소속 지점이 없습니다.");
  return insertInvite({ ...input, branchId: me.activeBranchId, createdBy: me.id });
}

/** account_request(create) 승인 시 decideAccountRequest 가 호출 — 이미 account.provision 확인됨. */
export async function issueInviteFromRequest(row: {
  branch_id: string | null;
  name: string | null;
  phone: string | null;
  title: string | null;
  hired_at: string | null;
  role_id: string | null;
  id: string;
}, decidedBy: string, branchFallback: string | null): Promise<StaffInviteRow> {
  const branchId = row.branch_id ?? branchFallback;
  if (!branchId || !row.name) throw new Error("신청 정보가 올바르지 않습니다.");
  return insertInvite({
    branchId, name: row.name, phone: row.phone, title: row.title, hiredAt: row.hired_at,
    roleId: row.role_id, createdBy: decidedBy, accountRequestId: row.id,
  });
}

/** 명단 탭에 뿌릴 초대 목록. code 는 발급 권한(account.provision)이 있는 사람에게만 내려준다 —
 *  조회만 가능한 사람(staff_schedule.view)에게는 "초대중"이라는 상태만 보이고 코드 자체는 안 보인다. */
export async function listInvites(me: Me, branchId: string): Promise<StaffInviteRow[]> {
  const r = await db.query<StaffInviteRow>(
    `select * from staff_invite where branch_id=$1 and status='pending' order by created_at desc`,
    [branchId],
  );
  if (can(me, "account.provision")) return r.rows;
  return r.rows.map((row) => ({ ...row, code: "" }));
}

/** 초대 취소(재발급 전 정리용). 이미 사용됐거나 만료된 것도 취소 표시는 가능(목록에서 치우는 용도). */
export async function revokeInvite(id: string): Promise<void> {
  const me = await guard("account.provision");
  await db.query(`update staff_invite set status='revoked' where id=$1 and branch_id=$2 and status='pending'`, [id, me.activeBranchId]);
}

// ---------------- 공개(비로그인) 초대 수락 흐름 — /invite/[code] ----------------

export type InviteLookup =
  | { ok: true; name: string; title: string | null; branchName: string }
  | { ok: false; reason: "notfound" | "used" | "revoked" | "expired" };

/** 코드로 초대 조회(비로그인). 존재하지 않음/만료/사용됨/취소됨을 구분해 안내하되, 코드 추측
 *  방어는 코드 길이(위 설명)로 하므로 여기서 사유를 굳이 숨기지 않는다(사유를 숨겨도 어차피
 *  코드 자체를 맞히지 못하면 의미가 없다 — 학생 access_code 처럼 "이름+코드"로 후보를 좁힐 수
 *  있는 구조가 아니다). */
export async function getInviteByCode(code: string): Promise<InviteLookup> {
  const norm = code.trim().toUpperCase();
  if (!norm) return { ok: false, reason: "notfound" };
  const r = await db.query<StaffInviteRow & { branch_name: string }>(
    `select si.*, b.name as branch_name from staff_invite si join branch b on b.id = si.branch_id where si.code=$1`,
    [norm],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "notfound" };
  const st = inviteStatus(row);
  if (st === "used") return { ok: false, reason: "used" };
  if (st === "revoked") return { ok: false, reason: "revoked" };
  if (st === "expired") return { ok: false, reason: "expired" };
  return { ok: true, name: row.name, title: row.title, branchName: row.branch_name };
}

export async function isLoginIdAvailable(loginId: string): Promise<boolean> {
  const id = normalizeLoginId(loginId);
  if (!id) return false;
  const r = await db.query(`select 1 from person where login_id=$1`, [id]);
  return r.rows.length === 0;
}

export type RedeemOutcome = { ok: true } | { ok: false; error: string };

/** 초대 코드로 본인이 아이디·비밀번호를 정해 계정을 만든다(비로그인 공개 액션). */
export async function redeemInvite(code: string, loginIdRaw: string, pin: string, pinConfirm: string): Promise<RedeemOutcome> {
  const norm = code.trim().toUpperCase();
  if (!norm) return { ok: false, error: "초대 코드를 확인해주세요." };
  const loginId = normalizeLoginId(loginIdRaw);
  if (!loginId) return { ok: false, error: "아이디는 영문 소문자·숫자로 입력하세요." };
  const pinBad = pinProblem(pin);
  if (pinBad) return { ok: false, error: pinBad };
  if (pin !== pinConfirm) return { ok: false, error: "비밀번호 확인이 일치하지 않습니다." };

  const r = await db.query<StaffInviteRow>(`select * from staff_invite where code=$1`, [norm]);
  const row = r.rows[0];
  if (!row) return { ok: false, error: "초대 코드를 찾을 수 없습니다." };
  const st = inviteStatus(row);
  if (st === "used") return { ok: false, error: "이미 사용된 초대 코드입니다." };
  if (st === "revoked") return { ok: false, error: "취소된 초대 코드입니다." };
  if (st === "expired") return { ok: false, error: "만료된 초대 코드입니다. 관리자에게 재발급을 요청하세요." };

  const dup = await db.query(`select 1 from person where login_id=$1`, [loginId]);
  if (dup.rows.length > 0) return { ok: false, error: "이미 사용 중인 아이디입니다." };

  // 초대 사용 처리를 원자적으로 먼저 선점(status='pending' 조건부 업데이트)해 동시에 두 번
  // 제출돼도 person 이 두 번 만들어지지 않게 한다.
  const claim = await db.query(
    `update staff_invite set status='used' where id=$1 and status='pending' returning id`,
    [row.id],
  );
  if (claim.rows.length === 0) return { ok: false, error: "이미 처리된 초대 코드입니다." };

  const person = await db.query<{ id: string }>(
    `insert into person(login_id, name, pin_hash, title, phone, hired_at, is_cto, active)
     values ($1,$2,$3,$4,$5,$6,false,true) returning id`,
    [loginId, row.name, hashPin(pin), row.title, row.phone, row.hired_at],
  );
  const personId = person.rows[0].id;

  if (row.role_id) {
    await db.query(
      `insert into person_role(person_id, branch_id, role_id) values ($1,$2,$3) on conflict do nothing`,
      [personId, row.branch_id, row.role_id],
    );
  }

  await db.query(`update staff_invite set used_at=now(), used_by_person_id=$1 where id=$2`, [personId, row.id]);
  return { ok: true };
}
