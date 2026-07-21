"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

async function record(branchId: string | null, studentId: string, kind: "in" | "out", auto: boolean, by: string) {
  await db.query(
    `insert into attendance_event(branch_id, student_id, kind, auto, date, created_by)
     values ($1,$2,$3,$4,$5,$6)`,
    [branchId, studentId, kind, auto, todayStr(), by],
  );
}

// 입실 기록 (불변)
export async function checkIn(formData: FormData) {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  if (!id) return;
  await record(me.activeBranchId, id, "in", false, me.id);
  revalidatePath("/m/seat");
}

// 퇴실 기록 (불변)
export async function checkOut(formData: FormData) {
  const me = await guard("attendance.edit");
  const id = s(formData.get("studentId"));
  if (!id) return;
  await record(me.activeBranchId, id, "out", false, me.id);
  revalidatePath("/m/seat");
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
