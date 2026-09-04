"use server";

// 공지 서버 액션(직원 관리 화면 m/notice 용). 조회는 notice.view(전 직원), 작성·수정·삭제는 notice.manage.
// 대상(audience)이 'staff'/'student' 둘 다 여기서 만들어진다 — 관리 로직(작성/수정/삭제)은 대상과
// 무관하게 같고, 다른 화면(학생 쪽)은 공개 폼 전용 액션(f/[slug]/forms/notice-actions.ts)이 조회·읽음만
// 별도로 맡는다(쓰기는 여기 하나로 통일 — 관리자만 올릴 수 있어야 하므로).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard, getMe } from "@/lib/auth";
import { NOTICE_IMAGE_MAX_COUNT, NOTICE_IMAGE_SERVER_MAX_BYTES, sniffImageType } from "@/lib/notice-image";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

type Audience = "staff" | "student";
function audienceOf(v: FormDataEntryValue | null): Audience {
  return v === "student" ? "student" : "staff";
}

function revalidateNotice() {
  revalidatePath("/m/notice");
  revalidatePath("/notice");
  revalidatePath("/f", "layout"); // 학생 허브 안 읽음 배지·목록 갱신
}

export type NoticeActionResult = { ok: true; id?: string } | { ok: false; error: string };

// FormData 의 "images" 필드(여러 개)를 실제 이미지 파일만 골라 반환. 브라우저가 이미 축소·재인코딩해서
// 보내지만("실 검증"은 서버가 함) 여기선 File 여부·빈 파일만 거른다 — 크기·형식 검증은 각 액션에서
// 사람이 읽을 오류 메시지와 함께 처리한다(어떤 파일이 왜 실패했는지 알려줘야 하므로 여기서 조용히
// 버리지 않는다).
function pickImageFiles(formData: FormData): File[] {
  return formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
}

// 매직 바이트 검증 + Buffer 변환. 실패하면 사람이 읽을 오류 메시지를 던진다(파일명 포함).
async function validateImage(file: File): Promise<{ type: "image/jpeg" | "image/webp"; buf: Buffer } | { error: string }> {
  if (file.size > NOTICE_IMAGE_SERVER_MAX_BYTES) {
    return { error: `사진 "${file.name}"이(가) 너무 큽니다(최대 ${Math.round(NOTICE_IMAGE_SERVER_MAX_BYTES / 1024)}KB). 다시 시도해주세요.` };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(buf);
  if (!type) return { error: `사진 "${file.name}"이(가) 지원하지 않는 형식입니다(JPEG·WebP만 가능).` };
  return { type, buf };
}

export async function createNotice(formData: FormData): Promise<NoticeActionResult> {
  const me = await guard("notice.manage");
  const title = s(formData.get("title"));
  const body = s(formData.get("body"));
  if (!title || !body) return { ok: false, error: "제목과 내용을 입력하세요." };
  const important = formData.get("important") === "on";
  const audience = audienceOf(formData.get("audience"));

  const files = pickImageFiles(formData);
  if (files.length > NOTICE_IMAGE_MAX_COUNT) {
    return { ok: false, error: `사진은 공지당 최대 ${NOTICE_IMAGE_MAX_COUNT}장까지 첨부할 수 있습니다.` };
  }
  const validated: { type: "image/jpeg" | "image/webp"; buf: Buffer }[] = [];
  for (const file of files) {
    const v = await validateImage(file);
    if ("error" in v) return { ok: false, error: v.error };
    validated.push(v);
  }

  const r = await db.query<{ id: string }>(
    `insert into notice(branch_id, author_id, title, body, important, audience) values ($1,$2,$3,$4,$5,$6) returning id`,
    [me.activeBranchId, me.id, title, body, important, audience],
  );
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, error: "저장에 실패했습니다." };
  // 작성자는 자기가 쓴 공지를 곧바로 읽은 것으로 처리 — 안 그러면 본인 화면에도 "안 읽음" 배지가 뜬다.
  // 학생용 공지는 작성자가 직원(person)이라 notice_read(person 기준)에 넣을 대상이 아니다 — 건너뛴다.
  if (audience === "staff") {
    await db.query(
      `insert into notice_read(notice_id, person_id) values ($1,$2) on conflict (notice_id, person_id) do nothing`,
      [id, me.id],
    );
  }
  for (let i = 0; i < validated.length; i++) {
    const v = validated[i];
    await db.query(
      `insert into notice_image(notice_id, position, content_type, byte_size, data) values ($1,$2,$3,$4,$5)`,
      [id, i, v.type, v.buf.length, v.buf],
    );
  }
  revalidateNotice();
  return { ok: true, id };
}

export async function updateNotice(formData: FormData): Promise<NoticeActionResult> {
  const me = await guard("notice.manage");
  const id = s(formData.get("id"));
  const title = s(formData.get("title"));
  const body = s(formData.get("body"));
  if (!id || !title || !body) return { ok: false, error: "제목과 내용을 입력하세요." };
  const important = formData.get("important") === "on";

  // 화면에서 지우기로 표시한 기존 사진 id들 + 새로 첨부한 파일들 — 저장(수정 완료) 한 번에 같이 반영.
  const removeIds = formData.getAll("removeImageId").map((v) => String(v)).filter(Boolean);
  const files = pickImageFiles(formData);
  const validated: { type: "image/jpeg" | "image/webp"; buf: Buffer }[] = [];
  for (const file of files) {
    const v = await validateImage(file);
    if ("error" in v) return { ok: false, error: v.error };
    validated.push(v);
  }

  const owned = await db.query(`select 1 from notice where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  if (owned.rows.length === 0) return { ok: false, error: "공지를 찾을 수 없습니다." };

  if (removeIds.length) {
    // fetch_types:false 인 배포 드라이버는 JS 배열을 배열로 못 보낸다 — 리터럴 "{a,b}" 로 넘긴다
    // (같은 파일 아래 idArr, patrolActions.ts 선례). uuid 형식만 남겨 리터럴에 이상한 값이 못 들어가게 한다.
    const rmArr = "{" + removeIds.filter((x) => UUID_RE_BROADCAST.test(x)).join(",") + "}";
    await db.query(`delete from notice_image where notice_id=$1 and id = any($2::uuid[])`, [id, rmArr]);
  }
  if (validated.length) {
    const countRow = await db.query<{ n: number }>(`select count(*)::int as n from notice_image where notice_id=$1`, [id]);
    if ((countRow.rows[0]?.n ?? 0) + validated.length > NOTICE_IMAGE_MAX_COUNT) {
      return { ok: false, error: `사진은 공지당 최대 ${NOTICE_IMAGE_MAX_COUNT}장까지입니다.` };
    }
    const posRow = await db.query<{ maxpos: number | null }>(`select max(position) as maxpos from notice_image where notice_id=$1`, [id]);
    let pos = (posRow.rows[0]?.maxpos ?? -1) + 1;
    for (const v of validated) {
      await db.query(
        `insert into notice_image(notice_id, position, content_type, byte_size, data) values ($1,$2,$3,$4,$5)`,
        [id, pos, v.type, v.buf.length, v.buf],
      );
      pos++;
    }
  }

  await db.query(
    `update notice set title=$3, body=$4, important=$5, updated_at=now() where id=$1 and branch_id=$2`,
    [id, me.activeBranchId, title, body, important],
  );
  revalidateNotice();
  return { ok: true, id };
}

export async function deleteNotice(formData: FormData) {
  const me = await guard("notice.manage");
  const id = s(formData.get("id"));
  if (!id) return;
  await db.query(`delete from notice where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidateNotice();
}

// deleteNotice 실행취소 — 삭제 직전 클라가 들고 있던 원본 값(id 포함) 그대로 재기록.
// 읽음 기록(notice_read)은 삭제로 cascade 소거된 채 되돌리지 않는다 — 실행취소 창(5초) 안에
// 누가 다시 읽었을 리 없고, "삭제된 원문 자체"만 복구하면 충분하다.
export async function restoreNotice(formData: FormData) {
  const me = await guard("notice.manage");
  const id = s(formData.get("id"));
  const authorId = s(formData.get("authorId"));
  const title = s(formData.get("title"));
  const body = s(formData.get("body"));
  const createdAt = s(formData.get("createdAt"));
  const updatedAt = s(formData.get("updatedAt"));
  const important = formData.get("important") === "true";
  const audience = audienceOf(formData.get("audience"));
  if (!id || !title || !body || !createdAt || !updatedAt) return;
  await db.query(
    `insert into notice(id, branch_id, author_id, title, body, important, audience, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, me.activeBranchId, authorId, title, body, important, audience, createdAt, updatedAt],
  );
  revalidateNotice();
}

// 공지 읽음 처리(원자적 upsert) — 폰 화면에서 공지를 열 때 호출. 같은 사람이 여러 번 열어도 1행 유지.
export async function markNoticeRead(formData: FormData) {
  const me = await guard("notice.view");
  const id = s(formData.get("id"));
  if (!id) return;
  // audience='staff' 인 공지만 person 기준 읽음으로 기록 — 학생용 공지를 직원 화면이 잘못 가리켜도
  // (있어서는 안 되지만) notice_read 에 뒤섞이지 않는다.
  await db.query(
    `insert into notice_read(notice_id, person_id)
     select $1, $2 from notice where id=$1 and audience='staff'
     on conflict (notice_id, person_id) do nothing`,
    [id, me.id],
  );
  revalidateNotice();
}

// ---------------- 공지 병행 발송(notice_broadcast) ----------------
// 학생용 공지를 올릴 때 "문자로도 보내기"를 선택하면 부른다. 문자를 실제로 보내는 게 아니라
// 후보(재원생 전원)+템플릿을 내려줄 뿐 — 실제 큐잉은 화면(NoticeList.tsx)이 SmsBatchSendModal 로
// 사람에게 미리보기·확인을 거친 뒤 sendNoticeBroadcastSms() 를 부를 때 일어난다(집주인 지시: 수동
// 발송은 누르기 전에 대상 수·문구·번호 없는 사람을 보여주고 2단계로 확정해야 한다 — 공지 저장과
// 문자 발송을 한 클릭에 묶지 않는다).
import { renderTemplate, type SmsSituation } from "@/lib/sms-template";
import { enqueueSmsBatch } from "@/lib/sms";
import type { SmsCandidate, SmsTemplateInfo, SendSmsResult } from "@/app/m/student/smsActions";

async function loadBroadcastTemplateAndBranchName(branchId: string): Promise<{ tmpl: SmsTemplateInfo; branchName: string }> {
  const situation: SmsSituation = "notice_broadcast";
  const [tmplR, branchR] = await Promise.all([
    db.query<SmsTemplateInfo>(`select title, body, enabled from sms_template where branch_id=$1::uuid and situation=$2`, [branchId, situation]),
    db.query<{ name: string }>(`select name from branch where id=$1::uuid`, [branchId]),
  ]);
  return { tmpl: tmplR.rows[0] ?? { title: "", body: "", enabled: false }, branchName: branchR.rows[0]?.name ?? "" };
}

export async function getNoticeBroadcastCandidates(): Promise<{ candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string }> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "" };
  const [r, { tmpl, branchName }] = await Promise.all([
    db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null }>(
      `select id, name, student_phone, guardian_phone from student where branch_id=$1::uuid and status='enrolled' order by name`,
      [branchId],
    ),
    loadBroadcastTemplateAndBranchName(branchId),
  ]);
  const candidates = r.rows.map((s) => ({ id: s.id, name: s.name, phone: s.guardian_phone || s.student_phone, code: null }));
  return { candidates, tmpl, branchName };
}

const UUID_RE_BROADCAST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendNoticeBroadcastSms(studentIds: string[], noticeTitle: string): Promise<SendSmsResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  if (studentIds.length === 0) return { ok: false, error: "대상을 선택하세요." };
  const { tmpl, branchName } = await loadBroadcastTemplateAndBranchName(branchId);
  if (!tmpl.enabled) return { ok: false, error: "이 상황이 꺼져 있습니다(문자 발송함 > 템플릿에서 켜세요)." };

  const idArr = "{" + studentIds.filter((id) => UUID_RE_BROADCAST.test(id)).join(",") + "}";
  const r = await db.query<{ id: string; name: string; student_phone: string | null; guardian_phone: string | null }>(
    `select id, name, student_phone, guardian_phone from student
      where branch_id=$1::uuid and id = any($2::uuid[]) and status='enrolled'`,
    [branchId, idArr],
  );
  const items = [];
  let skippedNoPhone = 0;
  for (const s of r.rows) {
    const phone = s.guardian_phone || s.student_phone;
    if (!phone) { skippedNoPhone++; continue; }
    const body = renderTemplate(tmpl.body, { 학원이름: branchName, 제목: noticeTitle });
    items.push({ branchId, phone, body, kind: "notice_broadcast" as const, studentId: s.id, requestedBy: me.id });
  }
  if (items.length === 0) return { ok: true, queued: 0, skippedNoPhone };
  const results = await enqueueSmsBatch(items);
  const queued = results.filter((x) => x.ok).length;
  return { ok: true, queued, skippedNoPhone: skippedNoPhone + (items.length - queued) };
}

// 폰 메뉴(MobileNav) 안 읽은 공지 배지용 — 로그인 여부만 확인(권한 없으면 0, 화면에 노출 안 됨).
export async function getUnreadNoticeCount(): Promise<number> {
  const me = await getMe();
  if (!me || !me.activeBranchId) return 0;
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from notice n
      where n.branch_id=$1
        and n.audience='staff'
        and not exists (select 1 from notice_read r where r.notice_id=n.id and r.person_id=$2)`,
    [me.activeBranchId, me.id],
  );
  return r.rows[0]?.n ?? 0;
}
