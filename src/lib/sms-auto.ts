// 자동 문자 발송 — situation.auto=true 인 상황(attend_in/attend_out/expiry_reminder/expired)이
// 실제로 큐에 쌓이는 자리. 두 갈래로 나뉜다(집주인 지시):
//   1) 즉시형(입·퇴실) — 그 이벤트가 기록되는 그 요청 안에서 바로 큐잉한다. 이 파일은 그 이벤트가
//      "실제 상태 전환"일 때만 불려야 한다(같은 이벤트를 반복 호출하면 안 됨) — 호출부
//      (attendanceActions.ts/patrolActions.ts)가 그 판단을 이미 하고 나서 여기를 부른다.
//   2) 일배치형(이용기간 만료) — 정해진 시각(기본 12:40 KST, branch_setting 으로 지점이 바꿀 수 있음)에
//      그날 대상자를 한 번에 모아 큐잉한다. 크론을 새로 만들지 않고, 발송기(scripts/sms-worker.mjs)가
//      이미 5분 간격 안전망으로 /api/sms-worker 를 부르는 경로에 얹는다(src/app/api/sms-worker/route.ts
//      의 action:'claim' 처리 직전 — claim 은 안전망이 무조건 5분마다 호출하므로 이 경로만으로 크론
//      없이 "하루 한 번, 대략 5분 오차 안에서" 실행을 보장한다).
import "server-only";
import { db } from "./db";
import { enqueueSms, enqueueSmsBatch, type SmsKind } from "./sms";
import { todayKey, dateLabelKo } from "./date";
import { renderTemplate } from "./sms-template";

// ---------------- 즉시형: 입·퇴실 알림 ----------------

type TemplateRow = { title: string; body: string; enabled: boolean };

async function loadTemplate(branchId: string, situation: "attend_in" | "attend_out"): Promise<TemplateRow | null> {
  const r = await db.query<TemplateRow>(
    `select title, body, enabled from sms_template where branch_id=$1::uuid and situation=$2`,
    [branchId, situation],
  );
  return r.rows[0] ?? null;
}

// 문자에 찍히는 학원 이름 — branch.name 을 그대로 쓰지 않는다. branch.name 은 "본점"처럼 내부에서
// 지점을 구분하는 라벨이라, 학부모에게 나가는 문자에 "[본점]" 으로 찍히면 어디서 온 문자인지 알 수
// 없다. 대외 이름은 따로 두고(branch_setting.academy_name, 문자 발송함 템플릿 탭에서 바꾼다),
// 설정이 없을 때만 branch.name 으로 물러선다.
export const SETTING_ACADEMY_NAME_KEY = "academy_name";

export async function getAcademyName(branchId: string): Promise<string> {
  const r = await db.query<{ value: string }>(
    `select value from branch_setting where branch_id=$1::uuid and key=$2`,
    [branchId, SETTING_ACADEMY_NAME_KEY],
  );
  const v = (r.rows[0]?.value ?? "").trim();
  if (v) return v;
  const b = await db.query<{ name: string }>(`select name from branch where id=$1::uuid`, [branchId]);
  return b.rows[0]?.name ?? "";
}

export async function setAcademyName(branchId: string, name: string): Promise<void> {
  await db.query(
    `insert into branch_setting(branch_id, key, value) values ($1::uuid, $2, $3)
     on conflict (branch_id, key) do update set value=excluded.value, updated_at=now()`,
    [branchId, SETTING_ACADEMY_NAME_KEY, name.trim()],
  );
}

async function branchName(branchId: string): Promise<string> {
  return getAcademyName(branchId);
}

/** 학생 한 명의 입·퇴실 문자를 큐잉한다(템플릿이 꺼져 있거나 번호가 없으면 조용히 아무것도 안 함 —
 *  이 경로는 사람이 미리보기로 확인할 기회가 없는 자동/즉시 경로라 실패를 사람에게 보여줄 곳이
 *  없다. 번호 없음은 로그로도 안 남긴다 — 전화번호를 로그에 남기지 않는다는 원칙과 별개로 "이
 *  학생은 번호가 없다"는 사실 자체도 개인 식별에 쓰일 수 있어 조용히 건너뛴다). 호출부가 이미
 *  "이번이 실제 상태 전환"임을 확인했다는 전제로 부른다(중복 호출 방지는 호출부 책임). */
export async function sendAttendanceSms(
  branchId: string,
  studentId: string,
  kind: "attend_in" | "attend_out",
  requestedBy: string | null,
): Promise<void> {
  const tmpl = await loadTemplate(branchId, kind);
  if (!tmpl || !tmpl.enabled) return;
  const stR = await db.query<{ name: string; guardian_phone: string | null; student_phone: string | null }>(
    `select name, guardian_phone, student_phone from student where id=$1::uuid and branch_id=$2::uuid`,
    [studentId, branchId],
  );
  const st = stR.rows[0];
  if (!st) return;
  const phone = st.guardian_phone || st.student_phone;
  if (!phone) return;
  const name = await branchName(branchId);
  const body = renderTemplate(tmpl.body, { 학생이름: st.name, 학원이름: name });
  await enqueueSms({ branchId, phone, body, kind, studentId, requestedBy });
}

/** sendAttendanceSms 의 배치판 — 순찰(patrolActions.ts)이 한 번에 여러 학생을 처리할 때 학생별로
 *  쿼리를 반복하면 N+1 이 되므로(90명이면 왕복 90번) 템플릿 1회 + 학생 조회 1회 + 큐잉 1배치로
 *  묶는다. items 는 이미 "실제 상태 전환"으로 걸러진 것만 넘어온다는 전제(호출부 책임). */
export async function sendAttendanceSmsBatch(
  branchId: string,
  items: { studentId: string; kind: "attend_in" | "attend_out" }[],
  requestedBy: string | null,
): Promise<void> {
  if (items.length === 0) return;
  const [inTmpl, outTmpl] = await Promise.all([loadTemplate(branchId, "attend_in"), loadTemplate(branchId, "attend_out")]);
  const templates: Record<"attend_in" | "attend_out", TemplateRow | null> = { attend_in: inTmpl, attend_out: outTmpl };
  const usable = items.filter((it) => templates[it.kind]?.enabled);
  if (usable.length === 0) return;

  const ids = [...new Set(usable.map((it) => it.studentId))];
  const idArr = "{" + ids.join(",") + "}"; // fetch_types:false 환경(운영) 배열 리터럴 관례(patrolActions.ts 와 동일)
  const stR = await db.query<{ id: string; name: string; guardian_phone: string | null; student_phone: string | null }>(
    `select id, name, guardian_phone, student_phone from student where branch_id=$1::uuid and id = any($2::uuid[])`,
    [branchId, idArr],
  );
  const studentOf = new Map(stR.rows.map((r) => [r.id, r]));
  const name = await branchName(branchId);

  const batch = usable
    .map((it) => {
      const st = studentOf.get(it.studentId);
      if (!st) return null;
      const phone = st.guardian_phone || st.student_phone;
      if (!phone) return null;
      const tmpl = templates[it.kind]!;
      const body = renderTemplate(tmpl.body, { 학생이름: st.name, 학원이름: name });
      return { branchId, phone, body, kind: it.kind as SmsKind, studentId: it.studentId, requestedBy };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (batch.length > 0) await enqueueSmsBatch(batch);
}

// ---------------- 일배치형: 이용기간 만료 임박·만료 ----------------

// billing/actions.ts EXPIRING_WITHIN_DAYS 와 같은 값 — "use server" 파일은 async 함수 외의 export 를
// 못 해(Next 제약) 직접 import 할 수 없어 복사해 둔다(sms.ts 상단 주석과 같은 관례). 바뀌면 두 곳 다.
const EXPIRING_WITHIN_DAYS = 7;

// 같은 학생에게 같은 상황(expiry_reminder|expired)이 7일 내내 매일 가지 않도록 억제하는 기간(일).
// expiry_reminder 는 7일짜리 창(만료 임박)이므로 3일에 한 번 정도(창 안에서 2~3회) 로 잡아 "매일"은
// 피하되 완전히 한 번만도 아니게 했다(연장을 계속 미루는 학부모에게 재차 환기는 필요). expired 는
// 만료 뒤 학부모가 조치할 때까지 무기한 이어질 수 있는 상태라 더 길게(1주일에 한 번)로 눌러
// 스팸처럼 느껴지지 않게 한다.
const REPEAT_SUPPRESS_DAYS: Record<"expiry_reminder" | "expired", number> = {
  expiry_reminder: 3,
  expired: 7,
};

// branch_setting 키 — schedule_auto_approve/schedule_auto_apply 와 같은 관례(값은 문자열).
//   sms_expiry_daily_time: "HH:MM"(KST, 24시간제). 없으면 기본 12:40.
//   sms_expiry_daily_ran:  마지막으로 이 일배치를 성공적으로 실행한 KST 날짜("YYYY-MM-DD").
//     오늘과 같으면 "오늘 몫은 이미 처리했다"로 보고 다시 돌지 않는다 — 이게 "하루에 한 번만"의
//     실체다(별도 표를 만들지 않고 이미 있는 branch_setting k/v 를 재사용 — schedule 쪽 자동 설정과
//     같은 자리에 두면 나중에 찾기도 쉽다). 실행이 도중에 실패(예외)하면 이 값을 쓰지 않는다 —
//     그래야 다음 5분 안전망 호출에서 다시 시도한다(부분 실패를 "완료"로 착각하지 않기 위함).
const SETTING_TIME_KEY = "sms_expiry_daily_time";
const SETTING_RAN_KEY = "sms_expiry_daily_ran";
export const DEFAULT_EXPIRY_DAILY_TIME = "12:40";

export async function getExpiryDailyTime(branchId: string): Promise<string> {
  const r = await db.query<{ value: string }>(
    `select value from branch_setting where branch_id=$1::uuid and key=$2`,
    [branchId, SETTING_TIME_KEY],
  );
  const v = r.rows[0]?.value;
  return v && /^\d{2}:\d{2}$/.test(v) ? v : DEFAULT_EXPIRY_DAILY_TIME;
}

export async function setExpiryDailyTime(branchId: string, hhmm: string): Promise<void> {
  await db.query(
    `insert into branch_setting(branch_id, key, value) values ($1::uuid, $2, $3)
     on conflict (branch_id, key) do update set value=excluded.value, updated_at=now()`,
    [branchId, SETTING_TIME_KEY, hhmm],
  );
}

/** 오늘(KST) 이 지점의 "HH:MM" 현재 시각. 코드가 아니라 화면(templateActions.ts)에서 바꿀 수 있는
 *  SETTING_TIME_KEY 와 문자열로 비교하기 위해 같은 "HH:MM" 형태로 만든다(제로패딩된 24시간제 문자열
 *  비교는 사전식 비교로도 시각 비교와 결과가 같다). */
function nowHHMMKST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
}

/** 모든 지점을 돌며 이용기간 만료 임박·만료 자동 발송을 처리한다. /api/sms-worker 의 action:'claim'
 *  처리 직전에 부른다(그 경로가 5분 안전망으로 항상 불리므로 별도 크론이 필요 없다 — 집주인 지시 검토
 *  결과). 각 지점은 독립적으로 실패해도(예: DB 일시 오류) 다른 지점 처리를 막지 않는다. */
export async function runDailyExpirySmsGeneration(): Promise<void> {
  const branches = await db.query<{ id: string }>(`select id from branch`);
  for (const b of branches.rows) {
    try {
      await generateForBranch(b.id);
    } catch (err) {
      console.error(`[sms-auto] 지점 ${b.id} 이용기간 자동 발송 실패:`, err instanceof Error ? err.message : String(err));
    }
  }
}

async function generateForBranch(branchId: string): Promise<void> {
  const today = todayKey();

  // 1) 오늘 이미 실행했으면 끝(하루 한 번 보장의 실체).
  const ranR = await db.query<{ value: string }>(
    `select value from branch_setting where branch_id=$1::uuid and key=$2`,
    [branchId, SETTING_RAN_KEY],
  );
  if (ranR.rows[0]?.value === today) return;

  // 2) 아직 예정 시각 전이면 끝(다음 5분 안전망 호출에서 다시 판정). 발송기가 그 시각에 꺼져 있었어도
  //    "오늘"이 바뀌지 않은 한 이 판정은 계속 "아직" 이 아니라 "이미 지남"으로 걸려 늦게라도 실행된다
  //    — 날짜가 바뀌면(자정을 넘기면) todayKey() 자체가 새 날짜가 되어 어제 몫은 그냥 건너뛴다(집주인
  //    지시: "날이 바뀌었으면 건너뛰는 게 맞다").
  const scheduled = await getExpiryDailyTime(branchId);
  if (nowHHMMKST() < scheduled) return;

  // 3) 상황별 템플릿(꺼져 있으면 그 상황은 대상에서 제외 — 둘 다 꺼져 있으면 조회조차 하지 않는다).
  const tmplR = await db.query<{ situation: string; title: string; body: string; enabled: boolean }>(
    `select situation, title, body, enabled from sms_template
      where branch_id=$1::uuid and situation in ('expiry_reminder','expired')`,
    [branchId],
  );
  const templates = new Map(tmplR.rows.map((t) => [t.situation, t]));
  const enabled = (["expiry_reminder", "expired"] as const).filter((s) => templates.get(s)?.enabled);

  if (enabled.length > 0) {
    // 4) 재원생의 최신 결제 기준 만료일 — 한 번의 조인으로(N+1 금지, billing/actions.ts
    //    getStudentBillingOverview 와 같은 lateral join 형태).
    const rows = await db.query<{ student_id: string; name: string; phone: string | null; period_end: string }>(
      `select s.id as student_id, s.name, coalesce(s.guardian_phone, s.student_phone) as phone, bp.period_end::text as period_end
         from student s
         join lateral (
           select bp2.period_end from billing_payment bp2
            where bp2.branch_id = s.branch_id and bp2.student_id = s.id
            order by bp2.period_end desc limit 1
         ) bp on true
        where s.branch_id = $1::uuid and s.status = 'enrolled'
          and bp.period_end <= (current_date + ($2 || ' days')::interval)`,
      [branchId, EXPIRING_WITHIN_DAYS],
    );

    type Candidate = { studentId: string; name: string; phone: string | null; periodEnd: string; situation: "expiry_reminder" | "expired" };
    const candidates: Candidate[] = [];
    for (const r of rows.rows) {
      const [ey, em, ed] = r.period_end.split("-").map(Number);
      const [ty, tm, td] = today.split("-").map(Number);
      const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
      const situation: "expiry_reminder" | "expired" = days < 0 ? "expired" : "expiry_reminder";
      if (!enabled.includes(situation)) continue;
      candidates.push({ studentId: r.student_id, name: r.name, phone: r.phone, periodEnd: r.period_end, situation });
    }

    if (candidates.length > 0) {
      // 5) 상황별 억제(반복 방지) — 최근 N일 안에 같은 지점·같은 상황으로 이미 큐잉된 학생은 뺀다.
      const bySituation = new Map<"expiry_reminder" | "expired", Candidate[]>();
      for (const c of candidates) {
        if (!bySituation.has(c.situation)) bySituation.set(c.situation, []);
        bySituation.get(c.situation)!.push(c);
      }
      const toSend: Candidate[] = [];
      for (const [situation, list] of bySituation) {
        const days = REPEAT_SUPPRESS_DAYS[situation];
        const ids = list.map((c) => c.studentId);
        const idArr = "{" + ids.join(",") + "}";
        const suppR = await db.query<{ student_id: string }>(
          `select distinct student_id from sms_message
            where branch_id=$1::uuid and kind=$2 and student_id = any($3::uuid[])
              and requested_at > now() - ($4 || ' days')::interval`,
          [branchId, situation, idArr, days],
        );
        const suppressed = new Set(suppR.rows.map((x) => x.student_id));
        for (const c of list) if (!suppressed.has(c.studentId)) toSend.push(c);
      }

      if (toSend.length > 0) {
        const name = await branchName(branchId);
        const items = toSend
          .filter((c) => c.phone) // 번호 없음 — 사람이 확인할 미리보기가 없는 자동 경로라 조용히 건너뜀
          .map((c) => {
            const tmpl = templates.get(c.situation)!;
            const body = renderTemplate(tmpl.body, { 학생이름: c.name, 만료일: dateLabelKo(c.periodEnd), 학원이름: name });
            return { branchId, phone: c.phone!, body, kind: c.situation as SmsKind, studentId: c.studentId, requestedBy: null };
          });
        if (items.length > 0) await enqueueSmsBatch(items);
      }
    }
  }

  // 6) 성공적으로 여기까지 왔으면(예외 없이) 오늘 몫 완료로 표시. 도중에 예외가 났으면 이 줄에 도달하지
  //    않아 다음 5분 호출에서 다시 시도한다 — 학생별 억제(5번)가 이미 큐잉된 사람은 자연히 걸러주므로
  //    재시도가 중복 발송으로 이어지지 않는다.
  await db.query(
    `insert into branch_setting(branch_id, key, value) values ($1::uuid, $2, $3)
     on conflict (branch_id, key) do update set value=excluded.value, updated_at=now()`,
    [branchId, SETTING_RAN_KEY, today],
  );
}

