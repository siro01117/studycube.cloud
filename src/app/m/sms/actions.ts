"use server";

// 문자 발송함 서버 액션. 조회는 sms.view, 재시도·삭제·테스트 발송 추가는 sms.manage — 둘 다
// bootstrap.ts ADMIN_PERM_KEYS 에 없어 CTO 전용이다(billing.*/payroll.* 와 같은 축, perms.ts 주석).
// 실제 발송(알리고 호출)은 이 파일이 하지 않는다 — 여기서 하는 일은 sms_message 를 읽고, 사람이
// 누른 재시도/삭제/테스트추가를 큐에 반영하는 것뿐이다. 큐에 새로 넣는 진입점은 언제나
// src/lib/sms.ts enqueueSms() 하나로 모은다(중복 방지·하루 상한을 여기서 우회하지 않기 위함).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/date";
import { enqueueSms } from "@/lib/sms";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SmsStatus = "queued" | "sending" | "sent" | "failed";
export type SmsRow = {
  id: string;
  phone: string;
  body: string;
  kind: string;
  status: SmsStatus;
  attempts: number;
  lastError: string;
  aligoMsgId: string;
  studentName: string | null;
  requestedByName: string | null;
  requestedLabel: string; // KST 서버 포맷
  sentLabel: string | null;
};

const TABS: Record<"pending" | "sent" | "failed", SmsStatus[]> = {
  pending: ["queued", "sending"],
  sent: ["sent"],
  failed: ["failed"],
};

export async function getSmsMessages(tab: "pending" | "sent" | "failed"): Promise<SmsRow[]> {
  const me = await guard("sms.view");
  const branchId = me.activeBranchId;
  if (!branchId) return [];
  const statuses = TABS[tab] ?? TABS.pending;
  const r = await db.query<{
    id: string; phone: string; body: string; kind: string; status: SmsStatus; attempts: number;
    last_error: string | null; aligo_msg_id: string | null; student_name: string | null;
    requested_by_name: string | null; requested_at: string; sent_at: string | null;
  }>(
    `select sm.id, sm.phone, sm.body, sm.kind, sm.status, sm.attempts, sm.last_error, sm.aligo_msg_id,
            st.name as student_name, p.name as requested_by_name,
            sm.requested_at::text as requested_at, sm.sent_at::text as sent_at
       from sms_message sm
       left join student st on st.id = sm.student_id
       left join person p on p.id = sm.requested_by
      where sm.branch_id = $1::uuid and sm.status = any($2::text[])
      order by sm.requested_at desc
      limit 300`,
    // fetch_types:false 인 배포 드라이버는 JS 배열을 배열로 못 보낸다 — 리터럴 "{a,b}" 로 넘긴다(patrolActions.ts 선례).
    [branchId, "{" + statuses.join(",") + "}"],
  );
  return r.rows.map((x) => ({
    id: x.id, phone: x.phone, body: x.body, kind: x.kind, status: x.status, attempts: x.attempts,
    lastError: x.last_error ?? "", aligoMsgId: x.aligo_msg_id ?? "",
    studentName: x.student_name, requestedByName: x.requested_by_name,
    requestedLabel: dateTimeLabel(x.requested_at),
    sentLabel: x.sent_at ? dateTimeLabel(x.sent_at) : null,
  }));
}

export type SmsActionResult = { ok: true } | { ok: false; error: string };

/** 실패건 다시 보내기 — attempts 를 0으로 되돌린다: 사람이 명시적으로 결정한 재시도라 자동 재시도
 *  횟수(SMS_MAX_ATTEMPTS)를 새로 다 쓸 수 있어야 한다(자동 재시도가 이미 소진한 걸 사람이 또 막혀
 *  있으면 "다시 보내기"가 무의미해진다). next_attempt_at 은 즉시(now())로 — 사람이 눌렀으니 백오프
 *  대기 없이 다음 발송기 실행에서 바로 집어가야 한다. */
export async function retrySms(formData: FormData): Promise<SmsActionResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  await db.query(
    `update sms_message set status='queued', attempts=0, next_attempt_at=now(), last_error=null
      where id=$1::uuid and branch_id=$2::uuid and status='failed'`,
    [id, branchId],
  );
  revalidatePath("/m/sms");
  return { ok: true };
}

export async function deleteSms(formData: FormData): Promise<SmsActionResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  await db.query(`delete from sms_message where id=$1::uuid and branch_id=$2::uuid`, [id, branchId]);
  revalidatePath("/m/sms");
  return { ok: true };
}

/** QA 전용 — 발송기 배선을 확인하기 위해 kind='test' 로 큐에 한 건 넣는다. 실제 발송 화면(접속코드
 *  안내 등)은 다음 단계에서 각자 enqueueSms() 를 직접 부른다 — 이 액션은 그 전용 자리가 아니다. */
export async function addTestSms(formData: FormData): Promise<SmsActionResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const phone = String(formData.get("phone") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || "[스터디큐브] 발송기 테스트 문자입니다.";
  const result = await enqueueSms({ branchId, phone, body, kind: "test", requestedBy: me.id });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/m/sms");
  return { ok: true };
}
