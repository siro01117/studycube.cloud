"use server";

// 학생 정기 스케쥴 제출(submission, type='schedule') 검토·반영 — ScheduleDemo.tsx 사이드바
// "제출 반영" 항목에서 진입하는 독립 뷰의 서버액션.
// 비교·검증은 src/lib/schedule-import.ts(JSON 일괄 반영과 동일 로직) + src/lib/schedule-submission.ts
// (payload → 그 로직이 받는 모양으로 감싸는 어댑터)를 그대로 재사용한다 — 재발명하지 않는다.
// 목록·비교 조회는 지점 전체를 3쿼리로(학생별 루프 없음), 반영은 선택된 제출들을 묶어서 처리한다.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/date";
import { academyToDbFields, type ImportHours, type DbAcademy } from "@/lib/schedule-import";
import { adaptSubmissionPayload } from "@/lib/schedule-submission";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

// ---------------- 목록 + 비교용 베이스 조회 ----------------
export type SubStatus = "pending" | "done" | "rejected";

export type SubmissionRow = {
  id: string;
  studentId: string | null;
  studentName: string;
  studentMatched: boolean; // student_id 가 있고 실제 student 행과 조인이 됐는지 — false 면 "학생 미연결"
  seatNumber: number | null;
  status: SubStatus;
  note: string | null;
  payload: unknown; // 원시 jsonb — 화면(클라)이 adaptSubmissionPayload 로 검증·정규화한다
  createdLabel: string; // 마지막 제출(수정) 시각
  firstSubmittedLabel: string | null; // 최초 제출 시각(재제출해도 안 바뀜)
  processedLabel: string | null;
  processedByName: string | null;
};

export type BaseHours = { studentId: string; day: number; arrive: number; leave: number };
export type BaseAcademy = { studentId: string; reason: string; title: string; days: number[]; start: number; end: number };
export type SubmissionsBase = { submissions: SubmissionRow[]; hours: BaseHours[]; academies: BaseAcademy[] };

type SubmissionRowDb = {
  id: string;
  student_id: string | null;
  student_name: string | null;
  seat_number: number | null;
  submitter_name: string | null;
  payload: unknown;
  status: string;
  note: string | null;
  created_at: string;
  first_submitted_at: string | null;
  processed_at: string | null;
  processed_by_name: string | null;
};

export async function loadSubmissionsBase(): Promise<SubmissionsBase> {
  const me = await guard("schedule.view");
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");

  const [subRows, hoursRows, ruleRows] = await Promise.all([
    db.query<SubmissionRowDb>(
      `select sub.id, sub.student_id, st.name as student_name, seat.number as seat_number,
              sub.submitter_name, sub.payload, sub.status, sub.note,
              sub.created_at::text as created_at, sub.first_submitted_at::text as first_submitted_at,
              sub.processed_at::text as processed_at, p.name as processed_by_name
         from submission sub
         left join student st on st.id = sub.student_id
         left join seat on seat.current_student_id = st.id and seat.branch_id = sub.branch_id
         left join person p on p.id = sub.processed_by
        where sub.branch_id=$1 and sub.type='schedule'
        order by (case when sub.status='pending' then 0 else 1 end), sub.created_at desc`,
      [branchId],
    ),
    db.query<{ student_id: string; day: number; arrive_min: number; leave_min: number }>(
      `select student_id, day, arrive_min, leave_min from schedule_hours where branch_id=$1`,
      [branchId],
    ),
    db.query<{ student_id: string; reason: string; title: string; start_min: number; end_min: number; days: string }>(
      `select student_id, reason, title, start_min, end_min, days from schedule_rule where branch_id=$1 and kind='academy'`,
      [branchId],
    ),
  ]);

  const submissions: SubmissionRow[] = subRows.rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name ?? r.submitter_name ?? "(알 수 없음)",
    studentMatched: r.student_id != null && r.student_name != null,
    seatNumber: r.seat_number,
    status: (r.status as SubStatus) ?? "pending",
    note: r.note,
    payload: r.payload,
    createdLabel: dateTimeLabel(r.created_at),
    firstSubmittedLabel: r.first_submitted_at ? dateTimeLabel(r.first_submitted_at) : null,
    processedLabel: r.processed_at ? dateTimeLabel(r.processed_at) : null,
    processedByName: r.processed_by_name,
  }));

  return {
    submissions,
    hours: hoursRows.rows.map((r) => ({ studentId: r.student_id, day: r.day, arrive: r.arrive_min, leave: r.leave_min })),
    academies: ruleRows.rows.map((r) => ({
      studentId: r.student_id,
      reason: r.reason,
      title: r.title,
      days: r.days ? r.days.split(",").map(Number).filter((n) => Number.isFinite(n)) : [],
      start: r.start_min,
      end: r.end_min,
    })),
  };
}

// ---------------- 반영 ----------------
// 클라가 보낸 hours/academies 를 신뢰하지 않는다 — 승인은 신뢰 판정이라, 선택된 submission id 만 받아
// DB의 payload 를 서버에서 다시 조회·검증해서 쓴다(JSON 일괄 반영의 applyImportSelection 과 다른 점 —
// 그쪽은 업로드된 파일이 애초에 서버가 모르는 새 데이터라 클라가 정제한 값을 그대로 받는 게 맞지만,
// 여기는 이미 DB에 있는 제출을 "그대로 반영"하는 것이므로 재조회가 맞다).
export type ApplySubmissionsResult = {
  applied: number;
  appliedIds: string[]; // 반영에 성공한 submission id
  failed: { id: string; name: string; error: string }[];
};

export async function applySubmissions(idsJson: string): Promise<ApplySubmissionsResult> {
  const me = await guard("schedule.manage");
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");

  let ids: unknown;
  try {
    ids = JSON.parse(idsJson);
  } catch {
    throw new Error("입력값을 확인하세요");
  }
  if (!Array.isArray(ids)) throw new Error("입력값을 확인하세요");
  const uniqIds = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (uniqIds.length === 0) return { applied: 0, appliedIds: [], failed: [] };

  const params: string[] = [branchId];
  const ph = uniqIds.map((id) => {
    params.push(id);
    return `$${params.length}`;
  });
  const rows = await db.query<{ id: string; student_id: string | null; student_name: string | null; payload: unknown; status: string }>(
    `select sub.id, sub.student_id, st.name as student_name, sub.payload, sub.status
       from submission sub
       left join student st on st.id = sub.student_id and st.status='enrolled'
      where sub.branch_id=$1 and sub.type='schedule' and sub.id in (${ph.join(",")})`,
    params,
  );
  const found = new Map(rows.rows.map((r) => [r.id, r]));

  const failed: { id: string; name: string; error: string }[] = [];
  const usable: { id: string; studentId: string; hours: ImportHours[]; academies: DbAcademy[] }[] = [];
  const seenStudents = new Set<string>();

  for (const id of uniqIds) {
    const row = found.get(id);
    if (!row) {
      failed.push({ id, name: "-", error: "제출을 찾을 수 없습니다" });
      continue;
    }
    if (row.status !== "pending") {
      failed.push({ id, name: row.student_name ?? "-", error: "대기 중 상태가 아닙니다" });
      continue;
    }
    if (!row.student_id || !row.student_name) {
      failed.push({ id, name: row.student_name ?? "-", error: "재원생이 아닙니다(학생 정보 없음)" });
      continue;
    }
    if (seenStudents.has(row.student_id)) {
      failed.push({ id, name: row.student_name, error: "같은 학생의 다른 제출과 중복됩니다" });
      continue;
    }
    const result = adaptSubmissionPayload(row.payload, row.student_name, null, 0);
    if (!result.ok) {
      failed.push({ id, name: row.student_name, error: result.error });
      continue;
    }
    seenStudents.add(row.student_id);
    usable.push({
      id,
      studentId: row.student_id,
      hours: result.student.hours,
      academies: result.student.academies.map(academyToDbFields),
    });
  }

  if (usable.length === 0) return { applied: 0, appliedIds: [], failed };

  const targetStudentIds = usable.map((u) => u.studentId);

  // 기존 등하원 전부 + schedule_rule(kind='academy') 만 지우고 새로 넣는다(임시 일정·예외·다른 사유 보존).
  {
    const delParams: string[] = [branchId];
    const delPh = targetStudentIds.map((id) => {
      delParams.push(id);
      return `$${delParams.length}`;
    });
    await db.query(`delete from schedule_hours where branch_id=$1 and student_id in (${delPh.join(",")})`, delParams);
    await db.query(`delete from schedule_rule where branch_id=$1 and kind='academy' and student_id in (${delPh.join(",")})`, delParams);
  }

  {
    const insParams: (string | number)[] = [branchId];
    const values: string[] = [];
    for (const item of usable) {
      for (const h of item.hours) {
        const base = insParams.length;
        insParams.push(item.studentId, h.day, h.arrive, h.leave);
        values.push(`($1,$${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
      }
    }
    if (values.length > 0) {
      await db.query(
        `insert into schedule_hours(branch_id, student_id, day, arrive_min, leave_min) values ${values.join(",")}`,
        insParams,
      );
    }
  }

  {
    const insParams: (string | number)[] = [branchId];
    const values: string[] = [];
    for (const item of usable) {
      for (const a of item.academies) {
        const daysCsv = [...new Set(a.days)].sort((x, y) => x - y).join(",");
        const base = insParams.length;
        insParams.push(item.studentId, a.reason, a.title, a.start, a.end, daysCsv);
        values.push(`($1,$${base + 1},$${base + 2},'academy',$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
      }
    }
    if (values.length > 0) {
      await db.query(
        `insert into schedule_rule(branch_id, student_id, reason, kind, title, start_min, end_min, days) values ${values.join(",")}`,
        insParams,
      );
    }
  }

  {
    const updParams: string[] = [me.id, branchId];
    const updPh = usable.map((u) => {
      updParams.push(u.id);
      return `$${updParams.length}`;
    });
    await db.query(
      `update submission set status='done', note=null, processed_by=$1, processed_at=now()
        where branch_id=$2 and id in (${updPh.join(",")})`,
      updParams,
    );
  }

  revalidatePath("/m/schedule");
  return { applied: usable.length, appliedIds: usable.map((u) => u.id), failed };
}

// ---------------- 반려 ----------------
export async function rejectSubmission(formData: FormData): Promise<void> {
  const me = await guard("schedule.manage");
  const id = s(formData.get("id"));
  const note = s(formData.get("note")) || null;
  if (!id) throw new Error("요청을 확인하세요");
  const r = await db.query(
    `update submission set status='rejected', note=$1, processed_by=$2, processed_at=now()
      where id=$3 and branch_id=$4 and type='schedule' and status='pending' returning id`,
    [note, me.id, id, me.activeBranchId],
  );
  if (r.rows.length === 0) throw new Error("대기 중인 제출이 아닙니다");
  revalidatePath("/m/schedule");
}

// ---------------- 테스트 제출 삭제 ----------------
// 개발 중 "테스트로 건너뛰기"(f/actions.ts testBypass)로 만들어진 제출은 실제 학생 데이터가 아니라
// 목록에 계속 남아 있어도 반영할 수 없다 — 행에서 바로 지울 수 있게 한다. 실제 학생 제출을 실수로
// 지우는 사고를 막기 위해, 클라가 어떤 값을 보내든 서버가 "테스트 제출인지"를 다시 판정해서 아니면
// 거부한다(payload._test===true 이거나 student_id 가 null인 경우만 — SubmissionsView.tsx 의 판정과 동일).
export async function deleteSubmission(id: string): Promise<void> {
  const me = await guard("schedule.manage");
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");
  if (!id) throw new Error("요청을 확인하세요");

  const rows = await db.query<{ id: string; student_id: string | null; payload: unknown }>(
    `select id, student_id, payload from submission where id=$1 and branch_id=$2 and type='schedule'`,
    [id, branchId],
  );
  const row = rows.rows[0];
  if (!row) throw new Error("제출을 찾을 수 없습니다");

  const p = row.payload;
  const isTestPayload = typeof p === "object" && p !== null && !Array.isArray(p) && (p as Record<string, unknown>)._test === true;
  if (!isTestPayload && row.student_id != null) {
    throw new Error("테스트 제출만 삭제할 수 있습니다");
  }

  await db.query(`delete from submission where id=$1 and branch_id=$2`, [id, branchId]);
  revalidatePath("/m/schedule");
}
