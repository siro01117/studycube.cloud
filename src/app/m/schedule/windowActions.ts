"use server";

// 스케쥴 입력 기간 관리 — schedule_window(지점 전체 기간) / schedule_grant(학생 개별 개방) CRUD +
// 제출 현황 조회. 판정 자체(순수 로직)는 lib/schedule-window.ts 를 그대로 재사용한다(로직 재발명 금지) —
// 여기서는 학생 목록·기간·개방을 한 번씩만 불러온 뒤 메모리에서 학생마다 evaluateEdit 을 돌린다
// (DB 를 학생 수만큼 왕복하지 않는다).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { dateTimeLabel } from "@/lib/date";
import { evaluateEdit, type EditDecision, type TimeRange } from "@/lib/schedule-window";
import { getFormSlugByType } from "@/app/f/registry";

const SCHEDULE_SLUG = getFormSlugByType("schedule") ?? "sch9m2vt";

export type PeriodStatus = "upcoming" | "active" | "ended";
export type WindowRow = { id: string; label: string | null; opensLabel: string; closesLabel: string; status: PeriodStatus };
export type GrantRow = {
  id: string; studentId: string; studentName: string; opensLabel: string; closesLabel: string;
  note: string | null; status: PeriodStatus;
};
export type SubmissionStatusRow = {
  studentId: string; studentName: string; seatNumber: number | null;
  submitted: boolean; lastSubmittedLabel: string | null; editable: boolean; reasonLabel: string;
};

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

function statusOf(opensAt: Date, closesAt: Date, now: Date): PeriodStatus {
  if (now < opensAt) return "upcoming";
  if (now >= closesAt) return "ended";
  return "active";
}

/** datetime-local 입력값("YYYY-MM-DDTHH:mm", 초 없음) → KST(UTC+9)로 해석한 절대시각.
 *  서버 TZ 와 무관하게 항상 KST 로 해석해야 하므로 브라우저의 Date 파싱에 맡기지 않고 오프셋을 직접 붙인다. */
function kstToInstant(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------- 입력 기간(schedule_window) ----------------
export async function listWindows(): Promise<WindowRow[]> {
  const me = await guard("schedule.view");
  const r = await db.query<{ id: string; label: string | null; opens_at: string; closes_at: string }>(
    `select id, label, opens_at, closes_at from schedule_window where branch_id=$1 order by opens_at desc`,
    [me.activeBranchId],
  );
  const now = new Date();
  return r.rows.map((row) => ({
    id: row.id,
    label: row.label,
    opensLabel: dateTimeLabel(row.opens_at),
    closesLabel: dateTimeLabel(row.closes_at),
    status: statusOf(new Date(row.opens_at), new Date(row.closes_at), now),
  }));
}

export async function createWindow(fd: FormData): Promise<WindowRow> {
  const me = await guard("schedule.manage");
  const label = s(fd.get("label")) || null;
  const opensAt = kstToInstant(s(fd.get("opensAt")));
  const closesAt = kstToInstant(s(fd.get("closesAt")));
  if (!opensAt || !closesAt) throw new Error("시작·종료 시각을 확인하세요");
  if (closesAt <= opensAt) throw new Error("종료 시각은 시작 시각보다 뒤여야 합니다");

  const row = await db.query<{ id: string; label: string | null; opens_at: string; closes_at: string }>(
    `insert into schedule_window(branch_id, label, opens_at, closes_at, created_by)
     values ($1,$2,$3,$4,$5)
     returning id, label, opens_at, closes_at`,
    [me.activeBranchId, label, opensAt.toISOString(), closesAt.toISOString(), me.id],
  );
  const r = row.rows[0];
  if (!r) throw new Error("저장에 실패했습니다");
  revalidatePath("/m/schedule");
  const now = new Date();
  return {
    id: r.id, label: r.label, opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at),
    status: statusOf(new Date(r.opens_at), new Date(r.closes_at), now),
  };
}

export async function deleteWindow(id: string): Promise<void> {
  const me = await guard("schedule.manage");
  await db.query(`delete from schedule_window where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/schedule");
}

// ---------------- 개별 개방(schedule_grant) ----------------
export async function listGrants(): Promise<GrantRow[]> {
  const me = await guard("schedule.view");
  const r = await db.query<{ id: string; student_id: string; student_name: string; opens_at: string; closes_at: string; note: string | null }>(
    `select g.id, g.student_id, st.name as student_name, g.opens_at, g.closes_at, g.note
       from schedule_grant g
       join student st on st.id = g.student_id
      where g.branch_id=$1
      order by g.opens_at desc`,
    [me.activeBranchId],
  );
  const now = new Date();
  return r.rows.map((row) => ({
    id: row.id, studentId: row.student_id, studentName: row.student_name,
    opensLabel: dateTimeLabel(row.opens_at), closesLabel: dateTimeLabel(row.closes_at), note: row.note,
    status: statusOf(new Date(row.opens_at), new Date(row.closes_at), now),
  }));
}

export async function createGrant(fd: FormData): Promise<GrantRow> {
  const me = await guard("schedule.manage");
  const studentId = s(fd.get("studentId"));
  const note = s(fd.get("note")) || null;
  const opensAt = kstToInstant(s(fd.get("opensAt")));
  const closesAt = kstToInstant(s(fd.get("closesAt")));
  if (!studentId) throw new Error("학생을 선택하세요");
  if (!opensAt || !closesAt) throw new Error("시작·종료 시각을 확인하세요");
  if (closesAt <= opensAt) throw new Error("종료 시각은 시작 시각보다 뒤여야 합니다");

  // 이 지점 학생인지 확인하며 삽입(다른 지점 studentId 로 개방을 만들 수 없게).
  const ins = await db.query<{ id: string; student_id: string; opens_at: string; closes_at: string; note: string | null }>(
    `insert into schedule_grant(branch_id, student_id, opens_at, closes_at, note, created_by)
     select $1, st.id, $3, $4, $5, $6 from student st where st.id=$2 and st.branch_id=$1
     returning id, student_id, opens_at, closes_at, note`,
    [me.activeBranchId, studentId, opensAt.toISOString(), closesAt.toISOString(), note, me.id],
  );
  const r = ins.rows[0];
  if (!r) throw new Error("학생을 찾을 수 없습니다");
  const nameRow = await db.query<{ name: string }>(`select name from student where id=$1`, [r.student_id]);

  revalidatePath("/m/schedule");
  const now = new Date();
  return {
    id: r.id, studentId: r.student_id, studentName: nameRow.rows[0]?.name ?? "",
    opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at), note: r.note,
    status: statusOf(new Date(r.opens_at), new Date(r.closes_at), now),
  };
}

export async function deleteGrant(id: string): Promise<void> {
  const me = await guard("schedule.manage");
  await db.query(`delete from schedule_grant where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/schedule");
}

// ---------------- 제출 현황 ----------------
function reasonLabelOf(decision: EditDecision): string {
  if (decision.open) {
    switch (decision.reason) {
      case "first": return "미제출 · 첫 제출 가능";
      case "grace": return "제출 직후(24시간 이내)";
      case "window": return "입력 기간 중";
      case "grant": return "개별 개방 중";
    }
  }
  return "잠김";
}

/** 재원생 전체의 제출 현황 + "지금 수정 가능한지"를 한 번에. 학생마다 DB 를 다시 묻지 않고
 *  (windows·grants 는 지점 전체를 한 번씩만 불러온 뒤) evaluateEdit 을 메모리에서 학생마다 돌린다. */
export async function listSubmissionStatus(): Promise<SubmissionStatusRow[]> {
  const me = await guard("schedule.view");
  const [studentRows, windowRows, grantRows] = await Promise.all([
    db.query<{ id: string; name: string; seat_number: number | null; first_submitted_at: string | null; created_at: string | null }>(
      `with sub as (
         select distinct on (student_id) student_id, first_submitted_at, created_at
           from submission
          where branch_id=$1 and type='schedule' and payload->>'_slug'=$2 and student_id is not null
          order by student_id, created_at desc
       )
       select s.id, s.name, seat.number as seat_number, sub.first_submitted_at, sub.created_at
         from student s
         left join seat on seat.current_student_id = s.id and seat.branch_id = s.branch_id
         left join sub on sub.student_id = s.id
        where s.branch_id=$1 and s.status='enrolled'
        order by seat.number nulls last, s.name`,
      [me.activeBranchId, SCHEDULE_SLUG],
    ),
    db.query<{ opens_at: string; closes_at: string }>(
      `select opens_at, closes_at from schedule_window where branch_id=$1`,
      [me.activeBranchId],
    ),
    db.query<{ student_id: string; opens_at: string; closes_at: string }>(
      `select student_id, opens_at, closes_at from schedule_grant where branch_id=$1`,
      [me.activeBranchId],
    ),
  ]);

  const now = new Date();
  const windows: TimeRange[] = windowRows.rows.map((r) => ({ opensAt: new Date(r.opens_at), closesAt: new Date(r.closes_at) }));
  const grantsByStudent = new Map<string, TimeRange[]>();
  for (const g of grantRows.rows) {
    const list = grantsByStudent.get(g.student_id) ?? [];
    list.push({ opensAt: new Date(g.opens_at), closesAt: new Date(g.closes_at) });
    grantsByStudent.set(g.student_id, list);
  }

  return studentRows.rows.map((row) => {
    const firstSubmittedAt = row.first_submitted_at ? new Date(row.first_submitted_at) : null;
    const decision = evaluateEdit({ now, firstSubmittedAt, windows, grants: grantsByStudent.get(row.id) ?? [] });
    return {
      studentId: row.id,
      studentName: row.name,
      seatNumber: row.seat_number,
      submitted: firstSubmittedAt != null,
      lastSubmittedLabel: row.created_at ? dateTimeLabel(row.created_at) : null,
      editable: decision.open,
      reasonLabel: reasonLabelOf(decision),
    };
  });
}
