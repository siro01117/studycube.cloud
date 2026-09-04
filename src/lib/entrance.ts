// 입구 태블릿(출입 키패드) 도메인 로직 — 기기 토큰 발급·검증, 학생 코드 무차별 대입 방어,
// 연타 방지, 학생이 고른 입·퇴실 기록. src/lib/staff-attendance.ts(QR 근태)와 같은 위치의 "그 화면 단일
// 출처" 파일 — DB·crypto 를 다루므로 서버 전용.
import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { hashPin, verifyPin } from "./hash";
import { todayKey, timeLabel } from "./date";
import { sendAttendanceSms } from "./sms-auto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 기기 토큰 ───────────────────────────────────────────────────────────
// 토큰은 URL 경로 세그먼트로 받는다(쿠키가 아니라) — 이 화면은 최초 1회 태블릿 브라우저 주소창에
// 입력(또는 QR/북마크)해 두고 그 뒤로는 하루 종일 그 탭을 그대로 켜 두는 "무인 키오스크"라 쿠키가
// 만료·삭제(태블릿 재부팅, 브라우저 데이터 삭제)돼도 화면이 죽지 않아야 한다 — 주소 자체가 곧
// 자격증명이면 탭을 다시 열기만 해도 복구된다. 대신 클라이언트 JS 소스에는 토큰 문자열을 단 한
// 글자도 하드코딩하지 않는다 — 코드 제출 fetch 는 `window.location.pathname`(주소창에 이미 있는
// 값을 브라우저가 읽어주는 것)을 그대로 재사용해, "페이지 소스"에 토큰이 별도 리터럴로 나타나지
// 않게 한다(주소창을 안 보여주는 키오스크 앱으로 감싸면 토큰이 화면 어디에도 보이지 않는다).
// 토큰 자체는 person.pin_hash 와 같은 원칙으로 해시만 저장한다(hash.ts scrypt) — 탈취 시 재사용
// 가능한 비밀이기 때문. 32바이트(256비트) 무작위값이라 길이만으로도 사실상 추측 불가능하다
// (staff-invite.ts 초대코드 10자·50비트 근거와 같은 결).
export type EntranceDevice = {
  id: string;
  branchId: string;
  name: string;
  active: boolean;
  createdAt: string;
  reissuedAt: string | null;
  lastSeenAt: string | null;
};

export async function listDevices(branchId: string): Promise<EntranceDevice[]> {
  const r = await db.query<EntranceDevice>(
    `select id, branch_id as "branchId", name, active,
            created_at::text as "createdAt", reissued_at::text as "reissuedAt",
            last_seen_at::text as "lastSeenAt"
       from entrance_device where branch_id=$1::uuid order by created_at`,
    [branchId],
  );
  return r.rows;
}

/** 새 기기 발급 — 토큰은 이 함수를 부른 응답에서만 보이고 DB 에는 해시만 남는다(재조회 불가,
 *  잃어버리면 재발급). */
export async function issueDevice(branchId: string, name: string, personId: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString("hex");
  const r = await db.query<{ id: string }>(
    `insert into entrance_device(branch_id, name, token_hash, created_by) values ($1::uuid,$2,$3,$4::uuid) returning id`,
    [branchId, name.trim() || "입구 태블릿", hashPin(token), personId],
  );
  return { id: r.rows[0]!.id, token };
}

/** 재발급 — 기존 토큰(과거 URL 을 아는 사람 포함)을 즉시 무효화하고 새 토큰을 돌려준다. */
export async function reissueDevice(deviceId: string): Promise<{ token: string } | null> {
  if (!UUID_RE.test(deviceId)) return null;
  const token = randomBytes(32).toString("hex");
  const r = await db.query<{ id: string }>(
    `update entrance_device set token_hash=$2, reissued_at=now() where id=$1::uuid returning id`,
    [deviceId, hashPin(token)],
  );
  if (!r.rows[0]) return null;
  return { token };
}

export async function setDeviceActive(deviceId: string, active: boolean): Promise<void> {
  if (!UUID_RE.test(deviceId)) return;
  await db.query(`update entrance_device set active=$2 where id=$1::uuid`, [deviceId, active]);
}

/** 주소의 deviceId+token 이 실제로 활성 기기와 일치하는지 검증. 일치하면 branchId 를 돌려준다
 *  (그 외 모든 조회·기록은 이 branchId 기준으로만 한다 — URL 을 아는 사람이 남의 지점 학생을
 *  건드릴 수 없게). */
export async function verifyDevice(deviceId: string, token: string): Promise<{ branchId: string } | null> {
  if (!UUID_RE.test(deviceId) || !token) return null;
  const r = await db.query<{ branch_id: string; token_hash: string }>(
    `select branch_id, token_hash from entrance_device where id=$1::uuid and active=true`,
    [deviceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!verifyPin(token, row.token_hash)) return null;
  return { branchId: row.branch_id };
}

// ── 학생 코드 무차별 대입 방어 (기기 단위) ────────────────────────────────
// access_attempt/login_attempt 와 같은 원자적 upsert 원리. 창·임계값 근거는 schema.modules.ts
// entrance_attempt 테이블 주석 참고 — 정상 사용(하루 수백 회)을 막지 않으면서 10만 가지 5자리
// 코드를 그 창 안에 다 시도하는 건 불가능하게 잡았다.
const ATTEMPT_WINDOW = "5 minutes";
const ATTEMPT_THRESHOLD = 20;
const ATTEMPT_LOCK = "5 minutes";

async function isDeviceLocked(deviceId: string): Promise<boolean> {
  const r = await db.query(
    `select 1 from entrance_attempt where device_id=$1::uuid and locked_until is not null and locked_until > now()`,
    [deviceId],
  );
  return r.rows.length > 0;
}

async function recordDeviceFailure(deviceId: string): Promise<void> {
  await db.query(
    `insert into entrance_attempt(device_id, fails, first_fail) values ($1::uuid,1,now())
     on conflict (device_id) do update set
       fails = case when entrance_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then 1 else entrance_attempt.fails + 1 end,
       first_fail = case when entrance_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then now() else entrance_attempt.first_fail end,
       locked_until = case when (case when entrance_attempt.first_fail < now() - interval '${ATTEMPT_WINDOW}' then 1 else entrance_attempt.fails + 1 end) >= ${ATTEMPT_THRESHOLD}
         then now() + interval '${ATTEMPT_LOCK}' else entrance_attempt.locked_until end`,
    [deviceId],
  );
}

async function clearDeviceFailure(deviceId: string): Promise<void> {
  await db.query(`delete from entrance_attempt where device_id=$1::uuid`, [deviceId]);
}

// ── 연타 방지 ──────────────────────────────────────────────────────────
// 같은 학생이 이 초 안에 두 번 찍으면(화면 반응이 느려 두 번 누르는 흔한 실수, 태블릿이라 터치가
// 씹혀 다시 누르는 경우 포함) 두 번째는 새로 기록하지 않고 직전 결과를 그대로 다시 보여준다.
// 5~10초 중 7초로 잡은 근거: 코드 5자리를 다시 누르는 데도 몇 초는 걸리므로 "같은 학생이 정말
// 다시 입실을 취소하고 싶어서" 짧은 시간 안에 재입력하는 합법적 상황은 거의 없고, 반대로 화면이
// 결과를 보여주는 시간(2~3초, 아래 클라이언트) 안에 실수로 재입력되는 사고는 7초면 충분히 덮는다.
const DEBOUNCE_SECONDS = 7;

// status 로 갈래를 나눈다(ok 불리언 하나로는 부족해서) — "이미 그 상태"는 실패가 아니라 사실을
// 알려주는 세 번째 결과다. 화면도 빨간 오류가 아니라 안내 색으로 보여주고, 오류보다 오래 띄운다
// (읽어야 하는 정보이기 때문 — route.ts 의 HOLD_MS 참고).
export type SubmitResult =
  | { status: "ok"; name: string; kind: "in" | "out"; at: string }
  | { status: "already"; name: string; kind: "in" | "out"; at: string }
  | { status: "error"; message: string };

/** 코드 제출 처리 — 학생이 화면에서 고른 kind(입실/퇴실) 그대로 기록한다. 예전에는 마지막 기록의
 *  반대로 자동 토글했는데, 그러면 학생은 자기가 무엇으로 찍히는지 누르기 전에 알 수 없고 직전
 *  기록이 어긋나 있으면(직원이 수동으로 만져둔 경우 등) 의도와 반대로 찍혔다 — 무인 경로에서
 *  되돌릴 사람이 없다는 점이 결정적이라 "고르고 누른다"로 바꿨다.
 *
 *  그 지점의 attend_in/attend_out 알림이 켜져 있으면 확인 없이 곧바로 문자 큐에 쌓는다
 *  (patrolActions.ts ensureCheckedInFromPatrol 과 같은 "사람이 누른 게 아니라 진짜 자동 처리라
 *  확인이 필요 없다" 취급 — 여기는 학생 본인이 코드를 눌렀을 뿐 직원 확인 절차가 없는 무인 경로다). */
export async function submitEntranceCode(
  deviceId: string,
  branchId: string,
  code: string,
  kind: "in" | "out",
): Promise<SubmitResult> {
  const cd = code.trim();
  if (!/^\d{5}$/.test(cd)) return { status: "error", message: "코드를 확인해주세요." };
  if (kind !== "in" && kind !== "out") return { status: "error", message: "다시 시도해주세요." };

  if (await isDeviceLocked(deviceId)) {
    return { status: "error", message: "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." };
  }

  const st = await db.query<{ id: string; name: string }>(
    `select id, name from student where branch_id=$1::uuid and status='enrolled' and access_code=$2`,
    [branchId, cd],
  );
  const student = st.rows[0];
  if (!student) {
    await recordDeviceFailure(deviceId);
    return { status: "error", message: "코드를 확인해주세요." };
  }
  await clearDeviceFailure(deviceId);
  await db.query(`update entrance_device set last_seen_at=now() where id=$1::uuid`, [deviceId]);

  const date = todayKey();
  const last = await db.query<{ kind: string; at: string }>(
    `select kind, at::text as at from attendance_event where student_id=$1 and branch_id=$2 and date=$3 order by at desc limit 1`,
    [student.id, branchId, date],
  );
  const lastRow = last.rows[0];

  // 이미 그 상태인가 — 고른 것과 직전 기록이 같으면 새로 찍지 않는다(입실 두 번, 퇴실 두 번 방지).
  // 두 갈래로 나뉘는 이유: DEBOUNCE_SECONDS 안의 재입력은 "화면이 느려 두 번 누른" 사고에 가까워
  // 그대로 성공을 다시 보여주는 게 맞고(학생을 혼내지 않는다), 그보다 오래된 기록이면 진짜로
  // 이미 처리된 것이라 몇 시에 찍혔는지 알려줘야 학생이 상황을 안다.
  if (lastRow && lastRow.kind === kind) {
    const at = timeLabel(lastRow.at);
    const fresh = Date.now() - new Date(lastRow.at).getTime() < DEBOUNCE_SECONDS * 1000;
    return { status: fresh ? "ok" : "already", name: student.name, kind, at };
  }

  const r = await db.query<{ at: string }>(
    `insert into attendance_event(branch_id, student_id, kind, auto, date, created_by)
     values ($1,$2,$3,true,$4,null) returning at::text as at`,
    [branchId, student.id, kind, date],
  );
  await sendAttendanceSms(branchId, student.id, kind === "in" ? "attend_in" : "attend_out", null);
  // 좌석 배치도(재실/부재 판정)가 이 기록을 즉시 반영하도록 — attendanceActions.ts checkIn/checkOut 과 동일.
  revalidatePath("/m/seat");
  revalidatePath("/seat");

  // 시각은 서버가 KST 로 만들어 내려준다 — 태블릿 시계가 틀어져 있어도(공장초기화 후 시간 미설정
  // 같은 흔한 상태) 화면에 엉뚱한 시각이 뜨지 않게. 클라 렌더에서 new Date() 금지 원칙과도 같은 결.
  return { status: "ok", name: student.name, kind, at: timeLabel(r.rows[0]!.at) };
}
