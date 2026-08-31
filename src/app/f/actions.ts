"use server";

// 공개 폼(/f/**) 공통 제출 액션. 설문마다 화면은 다르지만 저장 경로는 하나로 통일.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { resolveEditState, consumeActiveGrant } from "@/lib/schedule-window-server";
import { SCHEDULE_MIN_MIN, SCHEDULE_MAX_MIN } from "@/lib/schedule-import";
import { applySubmissionsCore, isScheduleAutoApplyOn } from "@/lib/schedule-submission-apply";
import { getForm } from "./registry";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

const MAX_PAYLOAD_BYTES = 16 * 1024; // payload 직렬화 길이 상한
const ANON_COOLDOWN_SECONDS = 5;     // 익명 폼: 같은 지점·슬러그 연속 제출 최소 간격

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

// ---- type: "schedule" 페이로드 검증 (f/[slug]/forms/sch9m2vt.tsx 가 만드는 shape) ----
// { hours: [{day,arrive,leave}], restDays: [day], academies: [{name,days,start,end}], note }
// 요일은 1~7, 분 값은 0~1560(=26:00, 자정 넘김 여유분 포함) 범위. 배열 길이·이름 길이 상한 초과나
// 범위 밖 값은 조용히 잘라내지 않고 통째로 거부한다(클라 버그로 이상값이 들어오면 바로 드러나야 함).
// hours.day 와 restDays 는 겹치면 안 되고, 함께 7개 요일을 정확히 한 번씩 덮어야 한다(중복·누락 거부).
const SCHEDULE_MAX_HOURS_DAYS = 7;
const SCHEDULE_MAX_ACADEMIES = 20;
const SCHEDULE_MAX_NAME_LEN = 40;
// 분 상한/하한(SCHEDULE_MIN_MIN/SCHEDULE_MAX_MIN)은 @/lib/schedule-import 가 단일 출처 — 이 파일과
// schedule-import.ts(관리자 "제출 반영"이 재검증할 때)·sch9m2vt.tsx(위저드가 미리 막을 때)가 전부 같은
// 값을 쓴다. 예전엔 여기 리터럴 1560 이 따로 있었고 위저드는 아예 상한 체크가 없어서, 자정을 새벽
// 2시 넘게 넘기는 하원/학원 시간을 학생이 3단계 검토까지 문제없이 진행한 뒤 제출에서만 걸렸다.

function isMinuteInRange(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= SCHEDULE_MIN_MIN && v <= SCHEDULE_MAX_MIN;
}
function isDay(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;
}

function validateSchedulePayload(payload: Record<string, unknown>): string | null {
  const hours = payload.hours;
  const hoursDays: number[] = [];
  if (hours !== undefined) {
    if (!Array.isArray(hours) || hours.length > SCHEDULE_MAX_HOURS_DAYS) return "요일 정보가 올바르지 않습니다.";
    const seenHourDays = new Set<number>();
    for (const raw of hours) {
      if (!raw || typeof raw !== "object") return "요일 정보가 올바르지 않습니다.";
      const h = raw as Record<string, unknown>;
      if (!isDay(h.day)) return "요일 값이 올바르지 않습니다.";
      if (!isMinuteInRange(h.arrive)) return "등원 시간이 올바르지 않습니다.";
      if (!isMinuteInRange(h.leave)) return "하원 시간이 올바르지 않습니다.";
      // schedule-import.ts validHours 와 동일 규칙(관리자 "제출 반영"에서 재검증할 때 같은 데이터가
      // 다른 결론에 이르지 않도록) — 여기서 먼저 걸러야 학생이 제출 시점에 바로 이유를 알 수 있다.
      if ((h.leave as number) <= (h.arrive as number)) {
        return `${h.day}요일 하원 시간이 등원 시간보다 늦어야 합니다(자정을 넘기면 다음날 새벽 2시까지만 가능해요).`;
      }
      if (seenHourDays.has(h.day as number)) return "같은 요일이 두 번 이상 들어있습니다.";
      seenHourDays.add(h.day as number);
      hoursDays.push(h.day as number);
    }
  }

  // restDays — hours 에 없는(등하원을 안 정한) "쉬는 날" 요일. hours 의 day 와 겹치면 안 되고,
  // 자체적으로도 중복이면 안 된다. 클라(sch9m2vt.tsx)는 hours+restDays 가 7개 요일을 정확히
  // 한 번씩 덮도록 만들어 보내므로, 둘 중 하나라도 온 경우엔 그 커버리지까지 확인한다.
  const restDaysRaw = payload.restDays;
  let restDays: number[] = [];
  if (restDaysRaw !== undefined) {
    if (!Array.isArray(restDaysRaw) || restDaysRaw.length > SCHEDULE_MAX_HOURS_DAYS || !restDaysRaw.every(isDay)) {
      return "쉬는 요일 정보가 올바르지 않습니다.";
    }
    restDays = restDaysRaw as number[];
    if (new Set(restDays).size !== restDays.length) return "쉬는 요일이 중복됩니다.";
  }
  if (hoursDays.some((d) => restDays.includes(d))) return "등·하원 요일과 쉬는 요일이 겹칩니다.";
  if (hours !== undefined || restDaysRaw !== undefined) {
    const combined = [...hoursDays, ...restDays];
    if (combined.length !== 7 || new Set(combined).size !== 7) {
      return "요일이 빠졌거나 중복됩니다 — 7개 요일을 모두 정해주세요.";
    }
  }

  const academies = payload.academies;
  if (academies !== undefined) {
    if (!Array.isArray(academies) || academies.length > SCHEDULE_MAX_ACADEMIES) return "학원 일정이 너무 많습니다.";
    for (const raw of academies) {
      if (!raw || typeof raw !== "object") return "학원 일정이 올바르지 않습니다.";
      const a = raw as Record<string, unknown>;
      if (typeof a.name !== "string" || a.name.length === 0 || a.name.length > SCHEDULE_MAX_NAME_LEN) return "학원 이름을 확인해주세요.";
      if (!Array.isArray(a.days) || a.days.length === 0 || a.days.length > 7 || !a.days.every(isDay)) return "학원 요일을 확인해주세요.";
      if (!isMinuteInRange(a.start)) return "학원 시작 시간을 확인해주세요.";
      if (!isMinuteInRange(a.end)) return "학원 종료 시간을 확인해주세요.";
      // schedule-import.ts validAcademies 와 동일 규칙 — 종료가 시작보다 늦어야 한다(자정 넘김은
      // end 를 +1440 해서 표현하므로, 여기서 걸리면 위저드의 상한 체크가 빠졌다는 뜻).
      if ((a.end as number) <= (a.start as number)) return "학원 종료 시간이 시작 시간보다 늦어야 합니다.";
    }
  }

  if (payload.note !== undefined && typeof payload.note !== "string") return "메모 형식이 올바르지 않습니다.";
  return null;
}

// kind:"identity" = 이름+코드 재검증 실패(허브에서 세션에 저장해둔 신원이 더 이상 안 먹힘,
// 코드가 바뀌었거나 잠긴 경우 등) — 폼은 이 경우 세션 신원을 지우고 "본인 확인이 만료됐어요"
// 화면으로 보낸다. kind 없는 실패(예: 스케쥴 값 검증 실패)는 폼 안에서 그대로 에러 문구만 보여준다.
export type SubmitResult = { ok: true } | { ok: false; error: string; kind?: "identity" };

/** 공개 폼 제출. FormData 필드: slug(필수), payload(JSON 문자열),
 *  requiresStudent 폼이면 name+code(서버가 재검증 — 클라가 넘긴 studentId 는 신뢰하지 않는다),
 *  아니면 submitterName/submitterPhone(선택, 표시용). */
export async function submitForm(formData: FormData): Promise<SubmitResult> {
  await ready();
  const slug = s(formData.get("slug"));
  const def = getForm(slug);
  if (!def) return { ok: false, error: "등록되지 않은 설문입니다." };
  if (!def.open) return { ok: false, error: "접수가 마감되었습니다." };

  const payloadRaw = s(formData.get("payload")) || "{}";
  if (Buffer.byteLength(payloadRaw, "utf8") > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: "입력이 너무 깁니다." };
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payloadRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad shape");
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: "요청이 올바르지 않습니다." };
  }

  if (def.type === "schedule") {
    const scheduleErr = validateSchedulePayload(payload);
    if (scheduleErr) return { ok: false, error: scheduleErr };
  }

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  let studentId: string | null = null;
  let submitterName = s(formData.get("submitterName")) || null;
  const submitterPhone = s(formData.get("submitterPhone")) || null;
  let testBypass = false; // 아래 DEV-ONLY 분기에서만 true 로 바뀐다. payload 에 _test 마킹할 때 씀.

  if (def.requiresStudent) {
    // 본인확인은 여기서 이름+코드로 다시 검증한다 — 앞 단계(허브의 StudentGate, 세션 저장)가
    // 이미 확인했더라도 클라가 들고 있는 studentId 를 그대로 신뢰하면 임의 값으로 다른 학생
    // 행세가 가능해진다. 세션 저장은 편의(폼마다 다시 안 묻기)일 뿐 신뢰 근거가 아니다.
    const name = s(formData.get("name"));
    const code = s(formData.get("code"));

    // ===== DEV-ONLY: 허브 "테스트로 건너뛰기" 우회 =========================
    // 개발 중 반복 테스트용. 허브가 만드는 테스트 신원은 code 가 비어있어 findStudent 를
    // 절대 통과할 수 없다(정상 동작). 그래서 NODE_ENV!=production 일 때만, 클라가 함께 보낸
    // test=1 플래그를 받아 이름+코드 검증을 건너뛰고 studentId 없이(=실제 학생 DB 행 아님,
    // FK 걸지 않음) 저장한다. process.env.NODE_ENV 는 빌드 타임에 고정되므로 이 분기는
    // 프로덕션 빌드에서는 절대 실행되지 않는다.
    testBypass = process.env.NODE_ENV !== "production" && s(formData.get("test")) === "1";
    if (testBypass) {
      studentId = null;
      submitterName = name || "테스트";
    } else {
      // =======================================================================
      const match = await findStudent(name, code);
      if (!match.ok) return { ok: false, error: publicAuthError(match.reason), kind: "identity" };
      studentId = match.id;
      submitterName = match.name;
    }

    // 스케쥴 폼은 "한 번도 제출한 적 없거나(첫 제출) 관리자가 활성화한 학생"만 제출을 받는다.
    // 화면(sch9m2vt.tsx)이 이미 잠김이면 폼 자체를 안 보여주지만, 그건 UX 일 뿐 — 여기서 다시
    // 판정해야 잠긴 상태의 제출을 실제로 막을 수 있다(클라를 우회해 직접 submitForm 을 호출하는
    // 경우 대비). 테스트 신원(testBypass)은 화면 판정(schedule-window-actions.ts checkScheduleWindow)과
    // 동일하게 항상 열림으로 취급.
    if (def.type === "schedule" && studentId && !testBypass) {
      const { state } = await resolveEditState(branch, studentId, def.type);
      if (!state.open) {
        return { ok: false, error: "이미 시간표를 제출했어요. 고쳐야 하면 카운터에 말씀해 주세요." };
      }
    }
  } else {
    // 익명 폼: 신원이 없어 개인 단위 제한은 불가 — 지점×슬러그 단위로 짧은 간격 연속 제출만 막는다.
    const recent = await db.query(
      `select 1 from submission
        where branch_id=$1 and type=$2 and payload->>'_slug'=$3
          and created_at > now() - interval '${ANON_COOLDOWN_SECONDS} seconds'
        limit 1`,
      [branch, def.type, slug],
    );
    if (recent.rows.length > 0) return { ok: false, error: "잠시 후 다시 시도해주세요." };
  }

  const payloadJson = JSON.stringify({ ...payload, _slug: slug, ...(testBypass ? { _test: true } : {}) });

  // 같은 학생 + 같은 슬러그 재제출 → 기본은 기존 행 갱신(폼 정의에 multiple:true 면 새로 쌓음).
  // select-then-insert 였던 예전 방식은 두 탭/기기가 거의 동시에 첫 제출을 하면 "기존 행 없음"을
  // 각자 보고 둘 다 insert 해 중복 행이 생겼다(schema.modules.ts uq_submission_student_type_slug
  // 참고) — insert...on conflict...do update 로 원자적으로 통일한다(forms/lunch-actions.ts 의
  // lunch_order upsert 와 같은 패턴). on conflict 대상은 그 유니크 인덱스와 정확히 같은 표현식이어야
  // 매칭된다: (branch_id, student_id, type, (payload->>'_slug')).
  let submissionId: string | null = null;
  if (studentId && !def.multiple) {
    const up = await db.query<{ id: string }>(
      `insert into submission(branch_id, type, student_id, submitter_name, submitter_phone, payload, status, first_submitted_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,'pending',now())
       on conflict (branch_id, student_id, type, (payload->>'_slug')) where student_id is not null
       do update set payload=excluded.payload, submitter_name=excluded.submitter_name,
                     submitter_phone=excluded.submitter_phone, status='pending', note=null, created_at=now()
       returning id`,
      [branch, def.type, studentId, submitterName, submitterPhone, payloadJson],
    );
    submissionId = up.rows[0]?.id ?? null;
  }

  if (submissionId == null) {
    const ins = await db.query<{ id: string }>(
      `insert into submission(branch_id, type, student_id, submitter_name, submitter_phone, payload, status, first_submitted_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,'pending',now())
       returning id`,
      [branch, def.type, studentId, submitterName, submitterPhone, payloadJson],
    );
    submissionId = ins.rows[0]?.id ?? null;
  }

  // 제출이 성공했으니(그 학생의 grant 로 열었든 첫 제출로 열었든) 유효한 활성화가 있으면 소진시킨다 —
  // 활성화는 1회용이라 이 제출로 끝난다. 제출 자체는 이미 커밋됐으므로, 소진이 실패해도(드묾) 제출을
  // 되돌리지 않는다 — 그 학생이 계속 열려 있는 상태로 남는 정도라 다음 제출로 자연히 정리된다.
  if (def.type === "schedule" && studentId && !testBypass) {
    try {
      await consumeActiveGrant(branch, studentId);
    } catch {
      // 소진 실패는 조용히 넘어간다(제출 자체는 이미 성공) — 위 주석 참고.
    }
  }

  // 정기 스케쥴 제출은 방학·개학처럼 빈도가 낮고 신뢰도가 높아 "제출하면 즉시 시간표에 반영"이 기본이다
  // (지점 설정 schedule_auto_apply, 기본 켜짐 — 설정 행이 없는 새 지점도 켜진 것으로 간주).
  // 관리자 "제출 반영" 화면의 수동 반영과 완전히 같은 경로(applySubmissionsCore)를 타야 결과가 갈리지
  // 않는다. 형식 오류·학생 미연결 등으로 실패하면 조용히 넘기지 않고 pending 상태로 남기고 사유를
  // submission.note 에 적어 관리자 화면(제출 반영 탭)에서 바로 보이게 한다.
  if (def.type === "schedule" && studentId && !testBypass && submissionId) {
    const autoOn = await isScheduleAutoApplyOn(branch);
    if (autoOn) {
      const result = await applySubmissionsCore(branch, [submissionId]);
      if (result.applied === 0 && result.failed[0]) {
        await db.query(`update submission set note=$1 where id=$2 and status='pending'`, [result.failed[0].error, submissionId]);
      }
    }
  }

  return { ok: true };
}
