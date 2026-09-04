"use server";

// 문자 템플릿 관리(=/m/sms 템플릿 탭). 조회는 sms.view, 저장·시각 변경은 sms.manage — 큐 관리 화면
// (actions.ts)과 같은 권한 축. 큐잉 자체는 여기서 하지 않는다 — 이 파일은 "문구/설정을 고친다"만
// 담당하고, 실제로 문자를 큐에 넣는 화면(학생 관리·공지·스케쥴)은 각자 src/lib/sms.ts 를 거친다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/date";
import {
  SMS_SITUATIONS, SITUATION_META, unknownVariablesIn, isSmsSituation, type SmsSituation,
} from "@/lib/sms-template";
import { getExpiryDailyTime, setExpiryDailyTime, DEFAULT_EXPIRY_DAILY_TIME } from "@/lib/sms-auto";
import {
  getSmsWorkerSecretMeta as getSmsWorkerSecretMetaLib,
  issueSmsWorkerSecret as issueSmsWorkerSecretLib,
} from "@/lib/sms-worker-secret";

export type TemplateRow = {
  situation: SmsSituation;
  label: string;
  auto: boolean;
  variables: readonly string[];
  title: string;
  body: string;
  enabled: boolean;
  updatedLabel: string | null; // KST 서버 포맷, 시드 그대로면 null(수정 이력 없음 표시)
};

export type WorkerSecretMeta = { issuedAtLabel: string; issuedBy: string } | null;

/** 템플릿 목록 + 이용기간 자동 배치 실행 시각 + 발송기 비밀 발급 여부. 상황이 DB 에 없어도(이론상
 *  시드가 안 됐을 때) 화면이 비어 보이지 않도록 SITUATION_META 기본값으로 채워 보여준다(단, 이 경우
 *  저장 전까지는 DB 에 실제 행이 없다 — saveTemplate 이 upsert 이므로 처음 저장할 때 자연히 생긴다). */
export async function getSmsTemplates(): Promise<{
  rows: TemplateRow[];
  expiryDailyTime: string;
  workerSecretMeta: WorkerSecretMeta;
}> {
  const me = await guard("sms.view");
  const branchId = me.activeBranchId;
  if (!branchId) return { rows: [], expiryDailyTime: DEFAULT_EXPIRY_DAILY_TIME, workerSecretMeta: null };
  const [r, expiryDailyTime, secretMeta] = await Promise.all([
    db.query<{ situation: string; title: string; body: string; enabled: boolean; updated_at: string }>(
      `select situation, title, body, enabled, updated_at::text as updated_at from sms_template where branch_id=$1::uuid`,
      [branchId],
    ),
    getExpiryDailyTime(branchId),
    getSmsWorkerSecretMetaLib(branchId),
  ]);
  const bysituation = new Map(r.rows.map((row) => [row.situation, row]));
  const rows: TemplateRow[] = SMS_SITUATIONS.map((situation) => {
    const meta = SITUATION_META[situation];
    const row = bysituation.get(situation);
    return {
      situation,
      label: meta.label,
      auto: meta.auto,
      variables: meta.variables,
      title: row?.title ?? meta.defaultTitle,
      body: row?.body ?? meta.defaultBody,
      enabled: row?.enabled ?? !meta.auto,
      updatedLabel: row ? dateTimeLabel(row.updated_at) : null,
    };
  });
  const workerSecretMeta: WorkerSecretMeta = secretMeta
    ? { issuedAtLabel: dateTimeLabel(secretMeta.issuedAt), issuedBy: secretMeta.issuedBy }
    : null;
  return { rows, expiryDailyTime, workerSecretMeta };
}

export type SaveTemplateResult = { ok: true } | { ok: false; error: string };

export async function saveSmsTemplate(formData: FormData): Promise<SaveTemplateResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const situation = String(formData.get("situation") ?? "");
  if (!isSmsSituation(situation)) return { ok: false, error: "알 수 없는 상황입니다." };
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  if (!title) return { ok: false, error: "제목을 입력하세요." };
  if (!body) return { ok: false, error: "내용을 입력하세요." };
  if (body.length > 2000) return { ok: false, error: "내용이 너무 깁니다." };

  // 이 상황에서 허용하지 않는 변수가 쓰였으면 저장을 막는다 — 발송 뒤에 "{만료일}" 이 그대로 나가는
  // 사고를 여기서 미리 차단한다(집주인 지시).
  const unknown = unknownVariablesIn(situation, body);
  if (unknown.length > 0) {
    return { ok: false, error: `이 상황에 없는 변수입니다: ${unknown.map((v) => `{${v}}`).join(", ")}` };
  }

  await db.query(
    `insert into sms_template(branch_id, situation, title, body, enabled, updated_by, updated_at)
     values ($1::uuid, $2, $3, $4, $5, $6::uuid, now())
     on conflict (branch_id, situation)
     do update set title=excluded.title, body=excluded.body, enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=now()`,
    [branchId, situation, title, body, enabled, me.id],
  );
  revalidatePath("/m/sms");
  return { ok: true };
}

/** 이용기간 자동 배치(expiry_reminder/expired) 를 매일 실행할 시각(KST, "HH:MM"). 코드에 박지 않고
 *  이 화면에서 바꿀 수 있게(집주인 지시) — branch_setting 에 저장(sms-auto.ts). */
export async function saveExpiryDailyTime(formData: FormData): Promise<SaveTemplateResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const hhmm = String(formData.get("time") ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return { ok: false, error: "시각 형식이 올바르지 않습니다(HH:MM)." };
  await setExpiryDailyTime(branchId, hhmm);
  revalidatePath("/m/sms");
  return { ok: true };
}

/** 발송기 공유 비밀 발급/재발급 — entrance.ts issueDevice 와 같은 모양: 원문은 이 응답에서만 보이고
 *  DB 에는 해시만 남는다(sms-worker-secret.ts). 재발급이라는 별도 동작이 없다 — 같은 함수가 upsert 라
 *  다시 부르면 그게 곧 재발급(이전 값 즉시 무효)이다. */
export type IssueWorkerSecretResult = { ok: true; secret: string } | { ok: false; error: string };

export async function issueSmsWorkerSecretAction(): Promise<IssueWorkerSecretResult> {
  const me = await guard("sms.manage");
  const branchId = me.activeBranchId;
  if (!branchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const secret = await issueSmsWorkerSecretLib(branchId, me.name);
  revalidatePath("/m/sms");
  return { ok: true, secret };
}
