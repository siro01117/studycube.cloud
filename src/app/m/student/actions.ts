"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

// ---------------- 학생 추가 ----------------
export async function addStudent(formData: FormData) {
  const me = await guard("student.edit");
  const name = s(formData.get("name"));
  if (!name) throw new Error("이름을 입력하세요");
  const level = s(formData.get("level")); // middle | high | adult
  await db.query(
    `insert into student
       (branch_id, name, level, grade, is_repeat, school, guardian_phone, student_phone, birthdate, gender, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'enrolled',$11)`,
    [
      me.activeBranchId,
      name,
      level,
      level === "adult" ? null : s(formData.get("grade")), // 성인은 학년 없음
      level === "adult" ? formData.get("is_repeat") != null : false,
      s(formData.get("school")),
      s(formData.get("guardian_phone")),
      s(formData.get("student_phone")),
      s(formData.get("birthdate")),
      s(formData.get("gender")),
      me.id,
    ],
  );
  revalidatePath("/m/student");
  revalidatePath("/m/seat");
}

// ---------------- 학생 영구 삭제 ----------------
// 입퇴실 기록(on delete cascade)은 DB 제약이 정리. 좌석은 FK가 current_student_id만
// NULL로 만들고 status='occupied'를 남겨 유령 '사용중' 좌석이 되므로 먼저 명시적으로 비운다.
export async function deleteStudent(formData: FormData) {
  const me = await guard("student.edit");
  const id = s(formData.get("id"));
  if (!id) return;
  await db.query(
    `update seat set current_student_id=null, status='empty', assigned_at=null
      where branch_id=$1 and current_student_id=$2`,
    [me.activeBranchId, id],
  );
  await db.query(`delete from student where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/student");
  revalidatePath("/m/seat");
}

// ---------------- 상태 변경 (재원/휴원) ----------------
export async function setStudentStatus(formData: FormData) {
  const me = await guard("student.edit");
  const id = s(formData.get("id"));
  const status = s(formData.get("status"));
  if (!id || !status) return;
  await db.query(`update student set status=$1 where id=$2 and branch_id=$3`, [
    status,
    id,
    me.activeBranchId,
  ]);
  // 휴원 처리 시 잡고 있던 좌석 자동 비움(복귀하면 다시 배정). 좌석맵·순찰·벌점 뷰 정합성 유지.
  if (status !== "enrolled") {
    await db.query(
      `update seat set current_student_id=null, status='empty', assigned_at=null
        where branch_id=$1 and current_student_id=$2`,
      [me.activeBranchId, id],
    );
  }
  revalidatePath("/m/student");
  revalidatePath("/m/seat");
}
