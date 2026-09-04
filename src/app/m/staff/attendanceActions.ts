"use server";

// 직원 근태 손 정정·수기 추가. 둘 다 staff_attendance.manage 전용(기본 CTO만 — bootstrap.ts
// ADMIN_PERM_KEYS 에는 staff_attendance.view 만 있고 manage 는 없다, staff_schedule 과 같은 축).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { parseClock } from "@/lib/staff-schedule"; // "HH:MM" ↔ 분 파서 재사용(근무표 화면과 같은 표기)
import { addDays } from "@/lib/date";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// f/[slug]/forms/schedule-request-actions.ts 와 같은 패턴 — id 를 쿼리에 리터럴/파라미터로 넣기 전에
// 모양부터 검증한다. 형식이 아니면 DB 예외(폼이 그대로 터짐) 대신 사람이 이해할 수 있는 안내를 준다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttResult = { ok: true } | { ok: false; error: string };

/** "HH:MM" + "YYYY-MM-DD"(KST 날짜 키) → 그 순간의 timestamptz(ISO, +09:00 고정) — 이 값은 정정 화면
 *  에서만 쓰인다(자동 QR 기록은 서버 now() 를 그대로 쓴다, staff-attendance.ts recordPunch).
 *  parseClock 은 근무표 화면과 표기를 맞추려고 24~27시(익일 새벽 근무)까지 분(min)으로 돌려준다 —
 *  그 값을 그대로 "24:30" 같은 시각 문자열로 박으면 Postgres 가 시(hour) 범위 위반으로 거부한다.
 *  24시 이후는 다음 날 00~03시로 굴려서(day rollover) 정상적인 timestamptz 로 만든다 — 근무표가
 *  이미 "익일 새벽 근무"를 그 표기로 허용하므로, 손 정정·수기 추가에서만 막으면 오히려 화면끼리
 *  표기가 어긋난다(집주인 지시: 판단해서 근거와 함께 보고). */
function toKstIso(date: string, hhmm: string): string | null {
  const min = parseClock(hhmm);
  if (min == null) return null;
  const rolledDate = min >= 1440 ? addDays(date, 1) : date;
  const dayMin = min % 1440;
  const hh = String(Math.floor(dayMin / 60)).padStart(2, "0");
  const mm = String(dayMin % 60).padStart(2, "0");
  return `${rolledDate}T${hh}:${mm}:00+09:00`;
}

export async function correctAttendance(formData: FormData): Promise<AttResult> {
  const me = await guard("staff_attendance.manage");
  const id = s(formData.get("id"));
  const date = s(formData.get("date"));
  const kind = s(formData.get("kind"));
  const time = s(formData.get("time"));
  const note = s(formData.get("note"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (!date || !DATE_RE.test(date)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  if (kind !== "in" && kind !== "out") return { ok: false, error: "출근/퇴근을 선택하세요." };
  const iso = time ? toKstIso(date, time) : null;
  if (!iso) return { ok: false, error: "시간이 올바르지 않습니다(HH:MM)." };

  // RETURNING 으로 실제 반영 여부를 확인한다 — id 가 이미 지워졌거나 다른 지점 소속이면(branch_id
  // 조건에 걸림) 0행이 갱신되는데, 그걸 그냥 넘기면 사용자는 "저장됐다"고 믿고 화면을 닫는다.
  const upd = await db.query<{ id: string }>(
    `update staff_attendance set kind=$3, at=$4::timestamptz, note=$5, corrected_by=$6, corrected_at=now()
      where id=$1 and branch_id=$2
      returning id`,
    [id, me.activeBranchId, kind, iso, note, me.id],
  );
  if (!upd.rows[0]) return { ok: false, error: "대상을 찾을 수 없습니다(이미 삭제됐거나 접근 권한이 없습니다)." };
  revalidatePath("/m/staff");
  return { ok: true };
}

export async function addManualAttendance(formData: FormData): Promise<AttResult> {
  const me = await guard("staff_attendance.manage");
  const personId = s(formData.get("personId"));
  const date = s(formData.get("date"));
  const kind = s(formData.get("kind"));
  const time = s(formData.get("time"));
  const note = s(formData.get("note"));
  if (!personId || !UUID_RE.test(personId)) return { ok: false, error: "대상 직원을 선택하세요." };
  if (!date || !DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
  if (kind !== "in" && kind !== "out") return { ok: false, error: "출근/퇴근을 선택하세요." };
  const iso = time ? toKstIso(date, time) : null;
  if (!iso) return { ok: false, error: "시간이 올바르지 않습니다(HH:MM)." };

  // personId 는 클라이언트가 고른 값이라(AddModal select) 반드시 이 지점 소속인지 서버에서 다시
  // 확인한다 — page.tsx 가 수기 추가 대상 목록(people)을 만들 때 쓰는 조건과 동일(is_cto 이거나
  // 이 지점 person_role 소속). 아니면 다른 지점 사람 이름으로 기록이 남는데 그 지점 화면 어디에도
  // 안 보이는 행이 된다(집주인 지시: 지점 소속 확인).
  const person = await db.query<{ id: string }>(
    `select id from person
      where id = $1 and active = true
        and (is_cto = true or id in (select person_id from person_role where branch_id = $2))`,
    [personId, me.activeBranchId],
  );
  if (!person.rows[0]) return { ok: false, error: "이 지점 소속 직원이 아닙니다." };

  // corrected_by/corrected_at 는 "손으로 고친 기록"에만 쓴다(schema.modules.ts 주석: 처음부터 수기
  // 추가면 null — created_by 가 이미 그 사람). 여기서 같이 채우면 화면이 "OO 정정"이라고 표시해
  // 새로 넣은 기록을 고친 기록처럼 보이게 만든다.
  await db.query(
    `insert into staff_attendance(branch_id, person_id, date, kind, at, source, note, created_by)
     values ($1,$2,$3,$4,$5::timestamptz,'manual',$6,$7)`,
    [me.activeBranchId, personId, date, kind, iso, note, me.id],
  );
  revalidatePath("/m/staff");
  return { ok: true };
}

export async function deleteAttendance(formData: FormData): Promise<AttResult> {
  const me = await guard("staff_attendance.manage");
  const id = s(formData.get("id"));
  if (!id || !UUID_RE.test(id)) return { ok: false, error: "대상을 찾을 수 없습니다." };
  const del = await db.query<{ id: string }>(
    `delete from staff_attendance where id=$1 and branch_id=$2 returning id`,
    [id, me.activeBranchId],
  );
  if (!del.rows[0]) return { ok: false, error: "대상을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)." };
  revalidatePath("/m/staff");
  return { ok: true };
}
