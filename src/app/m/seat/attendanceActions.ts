"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { todayKey as todayStr } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)
import { sendAttendanceSms } from "@/lib/sms-auto";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

async function record(branchId: string | null, studentId: string, kind: "in" | "out", auto: boolean, by: string, note: string | null = null) {
  await db.query(
    `insert into attendance_event(branch_id, student_id, kind, auto, date, created_by, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [branchId, studentId, kind, auto, todayStr(), by, note],
  );
}

// 그날 이 학생의 마지막 출결 이벤트 kind. "이번 기록이 실제 상태 전환인가"(직전과 kind 가 다른가)를
// 판단하는 데만 쓴다 — 같은 kind 를 또 찍는 건(버튼 두 번 눌림 등) 실제 전환이 아니므로 문자를 보낼
// 이유가 없다(patrolActions.ts ensureCheckedInFromPatrol 과 같은 판단 방식).
async function lastKindToday(branchId: string | null, studentId: string, date: string): Promise<string | null> {
  const r = await db.query<{ kind: string }>(
    `select kind from attendance_event where student_id=$1 and branch_id=$2 and date=$3 order by at desc limit 1`,
    [studentId, branchId, date],
  );
  return r.rows[0]?.kind ?? null;
}

/** 이 지점의 attend_in/attend_out 템플릿이 켜져 있는지(자동 문자 기능 자체가 활성인지). 꺼져 있으면
 *  화면에 "문자 보낼까요?" 확인조차 띄우지 않는다(보낼 방법이 없는데 물어볼 이유가 없다). */
async function attendanceSmsEnabled(branchId: string | null, kind: "attend_in" | "attend_out"): Promise<boolean> {
  if (!branchId) return false;
  const r = await db.query<{ enabled: boolean }>(
    `select enabled from sms_template where branch_id=$1::uuid and situation=$2`,
    [branchId, kind],
  );
  return r.rows[0]?.enabled ?? false;
}

export type AttendanceRecordResult = {
  ok: true;
  // true 면 화면이 "학부모에게 입실/퇴실 문자를 보낼까요?" 확인을 띄워야 한다(브라우저 confirm() 금지
  // — 화면 안 2단계, StudentPopup.tsx 등 호출부가 처리). false 면 조용히 끝(전환이 아니었거나 자동
  // 문자 기능 자체가 꺼져 있음).
  promptSms: boolean;
};

// 입실 기록 (불변)
// /m/seat(데스크톱)·/seat(모바일) 두 화면 모두 이 출결이 재실/부재 판정에 들어가므로 둘 다 갱신한다
// (예전엔 /m/seat 만 revalidate 해서 /seat 화면 수동 버튼이 로컬 낙관적 state 없인 반영되지 않았다).
//
// 문자는 여기서 자동으로 보내지 않는다 — 직원이 화면에서 수동으로 찍은 입·퇴실은 확인을 거쳐야
// 한다(집주인 지시: "자동으로 조용히 나가면 안 됨"). 대신 "물어봐도 되는 상황(실제 전환 + 기능
// 켜짐)"인지만 판단해 돌려주고, 화면이 사람에게 물은 뒤 확정되면 confirmAttendanceSms() 를 부른다.
// (patrolActions.ts 의 자동 경로는 이 판단 없이 곧바로 sendAttendanceSms 를 부른다 — 그쪽은 사람이
// 누른 게 아니라 진짜 자동 처리라 확인이 필요 없다.)
export async function checkIn(formData: FormData): Promise<AttendanceRecordResult> {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  if (!id) return { ok: true, promptSms: false };
  const date = todayStr();
  const [prevKind, smsOn] = await Promise.all([lastKindToday(me.activeBranchId, id, date), attendanceSmsEnabled(me.activeBranchId, "attend_in")]);
  await record(me.activeBranchId, id, "in", false, me.id);
  revalidatePath("/m/seat");
  revalidatePath("/seat");
  return { ok: true, promptSms: smsOn && prevKind !== "in" };
}

// 퇴실 기록 (불변) — checkIn 과 같은 이유로 문자는 여기서 보내지 않는다.
export async function checkOut(formData: FormData): Promise<AttendanceRecordResult> {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  if (!id) return { ok: true, promptSms: false };
  const note = s(formData.get("note"));
  const date = todayStr();
  const [prevKind, smsOn] = await Promise.all([lastKindToday(me.activeBranchId, id, date), attendanceSmsEnabled(me.activeBranchId, "attend_out")]);
  await record(me.activeBranchId, id, "out", false, me.id, note);
  revalidatePath("/m/seat");
  revalidatePath("/seat");
  return { ok: true, promptSms: smsOn && prevKind !== "out" };
}

// 직원이 "문자 보낼까요?" 확인에 "예"를 눌렀을 때만 실제로 큐잉한다(checkIn/checkOut 은 promptSms 만
// 돌려주고 보내지 않는다 — 위 주석). kind 는 checkIn/checkOut 이 이미 확정한 방향을 그대로 받는다.
export async function confirmAttendanceSms(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  const kind = s(formData.get("kind"));
  if (!id || (kind !== "attend_in" && kind !== "attend_out")) return { ok: false, error: "대상을 확인할 수 없습니다." };
  if (!me.activeBranchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  await sendAttendanceSms(me.activeBranchId, id, kind, me.id);
  return { ok: true };
}

// 마지막 기록 취소(오입력 정정용)
export async function undoLastEvent(formData: FormData) {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  const date = s(formData.get("date")) ?? todayStr();
  if (!id) return;
  await db.query(
    `delete from attendance_event
      where id = (select id from attendance_event
                   where student_id=$1 and branch_id=$2 and date=$3
                   order by at desc limit 1)`,
    [id, me.activeBranchId, date],
  );
  revalidatePath("/m/seat");
  revalidatePath("/seat");
}

// 특정 학생·날짜의 입·퇴실 기록 조회 (팝업용)
export async function getAttendanceEvents(studentId: string, date: string) {
  const me = await guard("attendance.view");
  const r = await db.query<{ kind: string; auto: boolean; at: string }>(
    `select kind, auto, at::text as at
       from attendance_event
      where student_id=$1 and branch_id=$2 and date=$3
      order by at`,
    [studentId, me.activeBranchId, date],
  );
  return r.rows;
}

// ---------------- 일일 결석 상태 (attendance 테이블: 학생×하루 1행) ----------------
// 입·퇴실 이벤트(attendance_event)와 별개. 결석은 "그날 상태 + 사유"로 남긴다.

// 특정 학생·날짜의 일일 상태 조회 (없으면 정상 등원으로 간주 → null)
export async function getDailyStatus(studentId: string, date: string) {
  const me = await guard("attendance.view");
  const r = await db.query<{ status: string; reason: string | null }>(
    `select status, reason from attendance where student_id=$1 and branch_id=$2 and date=$3`,
    [studentId, me.activeBranchId, date],
  );
  return r.rows[0] ?? null;
}

// 결석 처리(사유 포함). 같은 날 다시 부르면 사유만 갱신(upsert).
export async function setAbsent(formData: FormData) {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  const reason = s(formData.get("reason"));
  const date = s(formData.get("date")) ?? todayStr();
  if (!id) return;
  await db.query(
    `insert into attendance(branch_id, student_id, date, status, reason, created_by)
     values ($1,$2,$3,'absent',$4,$5)
     on conflict (student_id, date)
     do update set status='absent', reason=excluded.reason, updated_at=now()`,
    [me.activeBranchId, id, date, reason, me.id],
  );
  revalidatePath("/m/seat");
  revalidatePath("/m/student");
}

// 결석 취소 = 그 날 일일 상태 행 제거(정상 등원으로 되돌림)
export async function clearDailyStatus(formData: FormData) {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  const date = s(formData.get("date")) ?? todayStr();
  if (!id) return;
  await db.query(
    `delete from attendance where student_id=$1 and branch_id=$2 and date=$3`,
    [id, me.activeBranchId, date],
  );
  revalidatePath("/m/seat");
  revalidatePath("/m/student");
}
