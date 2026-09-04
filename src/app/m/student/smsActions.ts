"use server";

// 학생 관리 화면에서 보내는 문자 — "링크·로그인 코드 안내"(access_code)와 "스케쥴 미제출 독촉"
// (schedule_reminder) 둘 다 여기서 다룬다. 미리보기는 서버 왕복 없이 클라가 sms-template.ts
// renderTemplate() 을 직접 불러 만든다(같은 순수 함수를 서버·클라가 공유 — 집주인 지시). 이 파일은
// (1) 대상 후보 + 템플릿을 내려주는 조회, (2) 사람이 확정한 뒤 실제로 큐잉하는 두 가지만 한다.
// 권한은 학생 화면 자체의 student.edit 이 아니라 sms.manage 다(집주인 지시 — 문자 발송은 건당 실비 +
// 학부모 직접 발송이라 sms.* 축, /m/sms 와 동일).
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { enqueueSmsBatch } from "@/lib/sms";
import { renderTemplate, STUDENT_LOGIN_URL, type SmsSituation } from "@/lib/sms-template";

export type SmsCandidate = { id: string; name: string; phone: string | null; code: string | null };
export type SmsTemplateInfo = { title: string; body: string; enabled: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 클라가 넘긴 studentIds 는 문자열 배열 그대로 SQL 배열 리터럴에 이어붙이므로(fetch_types:false
// 환경 관례, patrolActions.ts 와 동일) 먼저 UUID 형식만 통과시킨다 — 여기서 거르지 않으면 임의
// 문자열이 SQL 리터럴에 그대로 들어가는 인젝션 통로가 된다.
function toUuidArrayLiteral(ids: string[]): string {
  return "{" + ids.filter((id) => UUID_RE.test(id)).join(",") + "}";
}

async function loadTemplateAndBranchName(branchId: string, situation: SmsSituation): Promise<{ tmpl: SmsTemplateInfo; branchName: string }> {
  const [tmplR, branchR] = await Promise.all([
    db.query<SmsTemplateInfo>(`select title, body, enabled from sms_template where branch_id=$1::uuid and situation=$2`, [branchId, situation]),
    db.query<{ name: string }>(`select name from branch where id=$1::uuid`, [branchId]),
  ]);
  return { tmpl: tmplR.rows[0] ?? { title: "", body: "", enabled: false }, branchName: branchR.rows[0]?.name ?? "" };
}

// ---------------- 링크·로그인 코드 안내(access_code) ----------------

/** 코드가 발급된 재원생 후보 + 템플릿 + 학원 이름. 전화번호는 학생이 직접 로그인하는 상황이라
 *  student_phone 을 우선하고 없으면 guardian_phone(학부모가 대신 로그인시켜 주는 경우도 있음). */
export async function getAccessCodeSmsCandidates(): Promise<{
  candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string; loginUrl: string;
}> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "", loginUrl: STUDENT_LOGIN_URL };
  const [r, { tmpl, branchName }] = await Promise.all([
    db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null; access_code: string }>(
      `select id, name, student_phone, guardian_phone, access_code from student
        where branch_id=$1::uuid and status='enrolled' and access_code is not null
        order by name`,
      [branchId],
    ),
    loadTemplateAndBranchName(branchId, "access_code"),
  ]);
  const candidates = r.rows.map((s) => ({ id: s.id, name: s.name, phone: s.student_phone || s.guardian_phone, code: s.access_code }));
  return { candidates, tmpl, branchName, loginUrl: STUDENT_LOGIN_URL };
}

export type SendSmsResult = { ok: true; queued: number; skippedNoPhone: number } | { ok: false; error: string };

export async function sendAccessCodeSms(studentIds: string[]): Promise<SendSmsResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  if (studentIds.length === 0) return { ok: false, error: "대상을 선택하세요." };
  const { tmpl, branchName } = await loadTemplateAndBranchName(branchId, "access_code");
  if (!tmpl.enabled) return { ok: false, error: "이 상황이 꺼져 있습니다(문자 발송함 > 템플릿에서 켜세요)." };

  const idArr = toUuidArrayLiteral(studentIds);
  const r = await db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null; access_code: string | null }>(
    `select id, name, student_phone, guardian_phone, access_code from student
      where branch_id=$1::uuid and id = any($2::uuid[]) and status='enrolled' and access_code is not null`,
    [branchId, idArr],
  );
  const items = [];
  let skippedNoPhone = 0;
  for (const s of r.rows) {
    const phone = s.student_phone || s.guardian_phone;
    if (!phone) { skippedNoPhone++; continue; }
    const body = renderTemplate(tmpl.body, { 학생이름: s.name, 코드: s.access_code ?? "", 링크: STUDENT_LOGIN_URL, 학원이름: branchName });
    items.push({ branchId, phone, body, kind: "access_code" as const, studentId: s.id, requestedBy: me.id });
  }
  if (items.length === 0) return { ok: true, queued: 0, skippedNoPhone };
  const results = await enqueueSmsBatch(items);
  const queued = results.filter((x) => x.ok).length;
  return { ok: true, queued, skippedNoPhone: skippedNoPhone + (items.length - queued) };
}

// ---------------- 스케쥴 미제출 독촉(schedule_reminder) ----------------

/** 등하원 스케쥴을 한 번도 제출하지 않은 재원생 — 홈 대시보드 "등하원 스케쥴 미제출" 과 같은 정의
 *  (src/app/home/nowActions.ts no_schedule 쿼리, 정의를 한곳에 두려면 원래 그 파일이 export 해야
 *  맞지만 거기는 여러 지표를 한 쿼리로 묶어서 재사용이 어려워 여기서 같은 조건을 그대로 복사한다). */
export async function getScheduleReminderCandidates(): Promise<{
  candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string;
}> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "" };
  const [r, { tmpl, branchName }] = await Promise.all([
    db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null }>(
      `select s.id, s.name, s.student_phone, s.guardian_phone from student s
        where s.branch_id=$1::uuid and s.status='enrolled'
          and not exists (select 1 from schedule_hours h where h.student_id=s.id)
        order by s.name`,
      [branchId],
    ),
    loadTemplateAndBranchName(branchId, "schedule_reminder"),
  ]);
  const candidates = r.rows.map((s) => ({ id: s.id, name: s.name, phone: s.guardian_phone || s.student_phone, code: null }));
  return { candidates, tmpl, branchName };
}

export async function sendScheduleReminderSms(studentIds: string[]): Promise<SendSmsResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  if (studentIds.length === 0) return { ok: false, error: "대상을 선택하세요." };
  const { tmpl, branchName } = await loadTemplateAndBranchName(branchId, "schedule_reminder");
  if (!tmpl.enabled) return { ok: false, error: "이 상황이 꺼져 있습니다(문자 발송함 > 템플릿에서 켜세요)." };

  const idArr = toUuidArrayLiteral(studentIds);
  const r = await db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null }>(
    `select id, name, student_phone, guardian_phone from student
      where branch_id=$1::uuid and id = any($2::uuid[]) and status='enrolled'
        and not exists (select 1 from schedule_hours h where h.student_id=student.id)`,
    [branchId, idArr],
  );
  const items = [];
  let skippedNoPhone = 0;
  for (const s of r.rows) {
    const phone = s.guardian_phone || s.student_phone;
    if (!phone) { skippedNoPhone++; continue; }
    const body = renderTemplate(tmpl.body, { 학생이름: s.name, 학원이름: branchName });
    items.push({ branchId, phone, body, kind: "schedule_reminder" as const, studentId: s.id, requestedBy: me.id });
  }
  if (items.length === 0) return { ok: true, queued: 0, skippedNoPhone };
  const results = await enqueueSmsBatch(items);
  const queued = results.filter((x) => x.ok).length;
  return { ok: true, queued, skippedNoPhone: skippedNoPhone + (items.length - queued) };
}
