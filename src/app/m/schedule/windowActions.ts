"use server";

// 스케쥴 입력 기간 관리 — schedule_window(지점 전체 기간) / schedule_grant(학생 개별 개방) CRUD +
// 제출 현황 조회. 판정 자체(순수 로직)는 lib/schedule-window.ts 를 그대로 재사용한다(로직 재발명 금지) —
// 여기서는 학생 목록·기간·개방을 한 번씩만 불러온 뒤 메모리에서 학생마다 evaluateEdit 을 돌린다
// (DB 를 학생 수만큼 왕복하지 않는다).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { dateTimeLabel, kstDateTimeLocal } from "@/lib/date";
import { evaluateEdit, type EditDecision, type TimeRange } from "@/lib/schedule-window";
import { getFormSlugByType } from "@/app/f/registry";

const SCHEDULE_SLUG = getFormSlugByType("schedule") ?? "sch9m2vt";

export type PeriodStatus = "upcoming" | "active" | "ended";
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

// ---------------- 입력 기간 — 하나의 폼(대상: 전체 학생 / 특정 학생)으로 통합 ----------------
// schedule_window(대상=전체 학생, 학생 없음)와 schedule_grant(대상=특정 학생 1명)는 테이블은 그대로 두고
// 화면·서버액션만 하나로 합친다 — 라벨(공통 입력)을 grant 에도 저장할 수 있도록 schedule_grant.label
// 컬럼만 추가했다(schema.modules.ts, SCHEMA_VERSION 2026-08-22.1).
export type OpeningKind = "window" | "grant";
export type OpeningRow = {
  id: string;
  kind: OpeningKind;
  label: string | null;
  target: string; // "전체 학생" 또는 학생 이름
  opensLabel: string;
  closesLabel: string;
  note: string | null;
  status: PeriodStatus;
};

const STATUS_WEIGHT: Record<PeriodStatus, number> = { active: 0, upcoming: 1, ended: 2 };

/** 입력 기간(전체) + 개별 개방을 하나의 목록으로 합쳐서 내려준다 — 진행중을 위로, 종료를 아래로
 *  (상태 우선, 같은 상태끼리는 시작 시각이 이른 순). 학생별 루프 쿼리 없이 두 테이블을 한 번씩만 읽는다. */
export async function listOpenings(): Promise<OpeningRow[]> {
  const me = await guard("schedule.view");
  const branchId = me.activeBranchId;
  const [winRows, grantRows] = await Promise.all([
    db.query<{ id: string; label: string | null; opens_at: string; closes_at: string }>(
      `select id, label, opens_at, closes_at from schedule_window where branch_id=$1`,
      [branchId],
    ),
    db.query<{ id: string; label: string | null; student_name: string; opens_at: string; closes_at: string; note: string | null }>(
      `select g.id, g.label, st.name as student_name, g.opens_at, g.closes_at, g.note
         from schedule_grant g
         join student st on st.id = g.student_id
        where g.branch_id=$1`,
      [branchId],
    ),
  ]);

  const now = new Date();
  const merged: (OpeningRow & { opensAtMs: number })[] = [
    ...winRows.rows.map((r) => {
      const opensAt = new Date(r.opens_at);
      const closesAt = new Date(r.closes_at);
      return {
        id: r.id, kind: "window" as const, label: r.label, target: "전체 학생",
        opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at), note: null,
        status: statusOf(opensAt, closesAt, now), opensAtMs: opensAt.getTime(),
      };
    }),
    ...grantRows.rows.map((r) => {
      const opensAt = new Date(r.opens_at);
      const closesAt = new Date(r.closes_at);
      return {
        id: r.id, kind: "grant" as const, label: r.label, target: r.student_name,
        opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at), note: r.note,
        status: statusOf(opensAt, closesAt, now), opensAtMs: opensAt.getTime(),
      };
    }),
  ];
  merged.sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] || a.opensAtMs - b.opensAtMs);
  return merged.map(({ opensAtMs: _drop, ...row }) => row);
}

/** 오늘(KST) 기준 시작·종료 기본값 — 시작=지금, 종료=7일 뒤 23:59. 클라 렌더에서 new Date() 를 쓰지
 *  않도록 폼이 마운트될 때 이 서버액션으로 값을 받아 채운다. */
export async function getOpeningDateDefaults(): Promise<{ start: string; end: string }> {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  // 날짜(KST)만 7일 뒤 것을 쓰고 시각은 23:59 로 고정 — "그날 안에는 다 받는다"는 취지의 기본값.
  const endDatePart = kstDateTimeLocal(end).slice(0, 10);
  return { start: kstDateTimeLocal(now), end: `${endDatePart}T23:59` };
}

/** FormData 필드: target("all"|"students"), studentIds(JSON 문자열 배열, target=students 일 때),
 *  label, opensAt, closesAt(datetime-local, KST), note. target=all 이면 schedule_window 1행,
 *  target=students 면 선택된 학생마다 schedule_grant 1행씩(한 번의 다중 VALUES insert로, 학생별
 *  왕복 없이) 만든다. */
export async function createOpening(fd: FormData): Promise<OpeningRow[]> {
  const me = await guard("schedule.manage");
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");

  const target = s(fd.get("target"));
  const label = s(fd.get("label")) || null;
  const note = s(fd.get("note")) || null;
  const opensAt = kstToInstant(s(fd.get("opensAt")));
  const closesAt = kstToInstant(s(fd.get("closesAt")));
  if (!opensAt || !closesAt) throw new Error("시작·종료 시각을 확인하세요");
  if (closesAt <= opensAt) throw new Error("종료 시각은 시작 시각보다 뒤여야 합니다");

  if (target === "all") {
    const row = await db.query<{ id: string; label: string | null; opens_at: string; closes_at: string }>(
      `insert into schedule_window(branch_id, label, opens_at, closes_at, created_by)
       values ($1,$2,$3,$4,$5)
       returning id, label, opens_at, closes_at`,
      [branchId, label, opensAt.toISOString(), closesAt.toISOString(), me.id],
    );
    const r = row.rows[0];
    if (!r) throw new Error("저장에 실패했습니다");
    revalidatePath("/m/schedule");
    const now = new Date();
    return [{
      id: r.id, kind: "window", label: r.label, target: "전체 학생",
      opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at), note: null,
      status: statusOf(new Date(r.opens_at), new Date(r.closes_at), now),
    }];
  }

  if (target !== "students") throw new Error("대상을 선택하세요");
  let studentIds: unknown;
  try {
    studentIds = JSON.parse(s(fd.get("studentIds")) || "[]");
  } catch {
    throw new Error("학생 선택을 확인하세요");
  }
  const uniqIds = Array.isArray(studentIds)
    ? [...new Set(studentIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (uniqIds.length === 0) throw new Error("학생을 1명 이상 선택하세요");

  // 이 지점 학생인지 확인하며 한 번의 다중 VALUES insert(학생별 왕복 쿼리 없이).
  const params: (string | number | null)[] = [branchId, label, opensAt.toISOString(), closesAt.toISOString(), note, me.id];
  const values = uniqIds.map((id) => {
    params.push(id);
    return `($1,$${params.length},$2,$3,$4,$5,$6)`;
  });
  const ins = await db.query<{ id: string; student_id: string; label: string | null; opens_at: string; closes_at: string; note: string | null }>(
    `insert into schedule_grant(branch_id, student_id, label, opens_at, closes_at, note, created_by)
     select v.branch_id, v.student_id, v.label, v.opens_at, v.closes_at, v.note, v.created_by
       from (values ${values.join(",")}) as v(branch_id, student_id, label, opens_at, closes_at, note, created_by)
       join student st on st.id = v.student_id and st.branch_id = v.branch_id
     returning id, student_id, label, opens_at, closes_at, note`,
    params,
  );
  if (ins.rows.length === 0) throw new Error("학생을 찾을 수 없습니다");

  const nameRows = await db.query<{ id: string; name: string }>(
    `select id, name from student where id in (${ins.rows.map((_, i) => `$${i + 1}`).join(",")})`,
    ins.rows.map((r) => r.student_id),
  );
  const nameOf = new Map(nameRows.rows.map((r) => [r.id, r.name]));

  revalidatePath("/m/schedule");
  const now = new Date();
  return ins.rows.map((r) => ({
    id: r.id, kind: "grant" as const, label: r.label, target: nameOf.get(r.student_id) ?? "",
    opensLabel: dateTimeLabel(r.opens_at), closesLabel: dateTimeLabel(r.closes_at), note: r.note,
    status: statusOf(new Date(r.opens_at), new Date(r.closes_at), now),
  }));
}

export async function deleteOpening(id: string, kind: OpeningKind): Promise<void> {
  const me = await guard("schedule.manage");
  if (kind === "window") {
    await db.query(`delete from schedule_window where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  } else {
    await db.query(`delete from schedule_grant where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  }
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
