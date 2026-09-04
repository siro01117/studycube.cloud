"use server";

// 직원 근무·수업·상담 일정 서버 액션. 조회는 staff_schedule.view(전 직원), 편집은 staff_schedule.manage.
// 겹침 검사는 src/lib/staff-schedule.ts 의 순수 함수(findPersonConflicts/findRoomConflicts)를 그대로
// 써서 화면의 즉시 미리보기와 같은 판정을 한다 — 서버가 최종 관문(클라를 우회해도 여기서 다시 막힌다).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import {
  STAFF_SCHEDULE_BY_KEY, findPersonConflicts, findRoomConflicts,
  type ScheduleBlock, type StaffScheduleKind,
} from "@/lib/staff-schedule";

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function num(v: FormDataEntryValue | null): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadPersonBlocks(branch: string, personId: string, date: string): Promise<ScheduleBlock[]> {
  const r = await db.query<{ id: string; person_id: string; room_id: string | null; date: string; start_min: number; end_min: number }>(
    `select id, person_id, room_id, date::text as date, start_min, end_min
       from staff_schedule where branch_id=$1 and person_id=$2 and date=$3`,
    [branch, personId, date],
  );
  return r.rows.map((row) => ({ id: row.id, personId: row.person_id, roomId: row.room_id, date: row.date, start: row.start_min, end: row.end_min }));
}
async function loadRoomBlocks(branch: string, roomId: string, date: string): Promise<ScheduleBlock[]> {
  const r = await db.query<{ id: string; person_id: string; room_id: string | null; date: string; start_min: number; end_min: number }>(
    `select id, person_id, room_id, date::text as date, start_min, end_min
       from staff_schedule where branch_id=$1 and room_id=$2 and date=$3`,
    [branch, roomId, date],
  );
  return r.rows.map((row) => ({ id: row.id, personId: row.person_id, roomId: row.room_id, date: row.date, start: row.start_min, end: row.end_min }));
}

async function validate(formData: FormData): Promise<
  | { ok: false; error: string }
  | { ok: true; id: string | null; personId: string; date: string; kind: StaffScheduleKind; roomId: string | null; start: number; end: number; note: string | null }
> {
  const id = s(formData.get("id"));
  const personId = s(formData.get("personId"));
  const date = s(formData.get("date"));
  const kind = s(formData.get("kind")) as StaffScheduleKind | null;
  const start = num(formData.get("start"));
  const end = num(formData.get("end"));
  const note = s(formData.get("note"));
  let roomId = s(formData.get("roomId"));

  if (!personId) return { ok: false, error: "담당자를 선택하세요." };
  if (!date || !DATE_RE.test(date)) return { ok: false, error: "날짜가 올바르지 않습니다." };
  if (!kind || !STAFF_SCHEDULE_BY_KEY[kind]) return { ok: false, error: "근무표 종류를 선택하세요." };
  if (start == null || end == null || end <= start) return { ok: false, error: "시간이 올바르지 않습니다." };
  const kindDef = STAFF_SCHEDULE_BY_KEY[kind];
  if (kindDef.needsRoom) {
    if (!roomId) return { ok: false, error: "공간을 선택하세요." };
  } else {
    roomId = null; // 카운터 근무는 공간 없음 — 실수로 넘어와도 항상 무시
  }
  return { ok: true, id, personId, date, kind, roomId, start, end, note };
}

export async function createStaffSchedule(formData: FormData): Promise<SaveResult> {
  const me = await guard("staff_schedule.manage");
  const v = await validate(formData);
  if (!v.ok) return v;
  const branch = me.activeBranchId!;
  const [personBlocks, roomBlocks] = await Promise.all([
    loadPersonBlocks(branch, v.personId, v.date),
    v.roomId ? loadRoomBlocks(branch, v.roomId, v.date) : Promise.resolve([] as ScheduleBlock[]),
  ]);
  const cand = { personId: v.personId, roomId: v.roomId, date: v.date, start: v.start, end: v.end };
  if (findPersonConflicts(personBlocks, cand).length) return { ok: false, error: "같은 사람이 이미 그 시간에 배정되어 있습니다." };
  if (findRoomConflicts(roomBlocks, cand).length) return { ok: false, error: "같은 공간이 이미 그 시간에 배정되어 있습니다." };

  const r = await db.query<{ id: string }>(
    `insert into staff_schedule(branch_id, person_id, date, start_min, end_min, kind, room_id, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [branch, v.personId, v.date, v.start, v.end, v.kind, v.roomId, v.note, me.id],
  );
  revalidatePath("/m/staff");
  return { ok: true, id: r.rows[0].id };
}

export async function updateStaffSchedule(formData: FormData): Promise<SaveResult> {
  const me = await guard("staff_schedule.manage");
  const v = await validate(formData);
  if (!v.ok) return v;
  if (!v.id) return { ok: false, error: "대상을 찾을 수 없습니다." };
  const branch = me.activeBranchId!;
  const [personBlocks, roomBlocks] = await Promise.all([
    loadPersonBlocks(branch, v.personId, v.date),
    v.roomId ? loadRoomBlocks(branch, v.roomId, v.date) : Promise.resolve([] as ScheduleBlock[]),
  ]);
  const cand = { id: v.id, personId: v.personId, roomId: v.roomId, date: v.date, start: v.start, end: v.end };
  if (findPersonConflicts(personBlocks, cand).length) return { ok: false, error: "같은 사람이 이미 그 시간에 배정되어 있습니다." };
  if (findRoomConflicts(roomBlocks, cand).length) return { ok: false, error: "같은 공간이 이미 그 시간에 배정되어 있습니다." };

  await db.query(
    `update staff_schedule set person_id=$3, date=$4, start_min=$5, end_min=$6, kind=$7, room_id=$8, note=$9
      where id=$1 and branch_id=$2`,
    [v.id, branch, v.personId, v.date, v.start, v.end, v.kind, v.roomId, v.note],
  );
  revalidatePath("/m/staff");
  return { ok: true, id: v.id };
}

export async function deleteStaffSchedule(formData: FormData) {
  const me = await guard("staff_schedule.manage");
  const id = s(formData.get("id"));
  if (!id) return;
  await db.query(`delete from staff_schedule where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/staff");
}

// deleteStaffSchedule 실행취소 — 삭제 직전 클라가 들고 있던 값 그대로 재기록(notice 모듈과 같은 패턴).
export async function restoreStaffSchedule(formData: FormData) {
  const me = await guard("staff_schedule.manage");
  const id = s(formData.get("id"));
  const personId = s(formData.get("personId"));
  const date = s(formData.get("date"));
  const kind = s(formData.get("kind"));
  const roomId = s(formData.get("roomId"));
  const start = num(formData.get("start"));
  const end = num(formData.get("end"));
  const note = s(formData.get("note"));
  if (!id || !personId || !date || !kind || start == null || end == null) return;
  await db.query(
    `insert into staff_schedule(id, branch_id, person_id, date, start_min, end_min, kind, room_id, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do nothing`,
    [id, me.activeBranchId, personId, date, start, end, kind, roomId, note, me.id],
  );
  revalidatePath("/m/staff");
}

// ---------------- 공간(room) 추가·수정·삭제 ----------------
// FloorEditor(/m/seat)의 createRoom/updateRoom/deleteRoom(perm=seat.manage, 좌석 격자 중심)과는 별도
// 경로 — 이 화면은 staff_schedule.manage 권한자가 "정원 표시용 방"(좌석 없는 1:1 방 등)을 다루므로
// 권한 축이 다르다. 같은 room 테이블에 함께 쓰되, 좌석이 있는 방(자습실)의 삭제는 좌석까지 함께
// 지우는 좌석 화면 쪽 책임으로 남겨두고 여기서는 거부한다(좌석 배치도가 말없이 망가지지 않게).
export type SpaceResult = { ok: true } | { ok: false; error: string };

export async function createSpace(formData: FormData): Promise<SpaceResult> {
  const me = await guard("staff_schedule.manage");
  const name = s(formData.get("name"));
  if (!name) return { ok: false, error: "공간 이름을 입력하세요." };
  const floor = num(formData.get("floor")) ?? 4;
  const capacityRaw = num(formData.get("capacity"));
  const capacity = capacityRaw != null && capacityRaw > 0 ? Math.round(capacityRaw) : null;
  await db.query(
    `insert into room(branch_id, name, floor, cols, rows, capacity) values ($1,$2,$3,8,6,$4)`,
    [me.activeBranchId, name, Math.round(floor), capacity],
  );
  revalidatePath("/m/staff");
  return { ok: true };
}

export async function updateSpace(formData: FormData): Promise<SpaceResult> {
  const me = await guard("staff_schedule.manage");
  const id = s(formData.get("id"));
  const name = s(formData.get("name"));
  if (!id || !name) return { ok: false, error: "공간 이름을 입력하세요." };
  const floor = num(formData.get("floor")) ?? 4;
  const capacityRaw = num(formData.get("capacity"));
  const capacity = capacityRaw != null && capacityRaw > 0 ? Math.round(capacityRaw) : null;
  await db.query(
    `update room set name=$3, floor=$4, capacity=$5 where id=$1 and branch_id=$2`,
    [id, me.activeBranchId, name, Math.round(floor), capacity],
  );
  revalidatePath("/m/staff");
  revalidatePath("/m/seat"); // 좌석 배치도 화면의 방 이름·층 표시도 같이 갱신
  return { ok: true };
}

export async function deleteSpace(formData: FormData): Promise<SpaceResult> {
  const me = await guard("staff_schedule.manage");
  const id = s(formData.get("id"));
  if (!id) return { ok: false, error: "대상을 찾을 수 없습니다." };
  const branch = me.activeBranchId;
  const seatCount = await db.query<{ n: number }>(`select count(*)::int as n from seat where room_id=$1`, [id]);
  if ((seatCount.rows[0]?.n ?? 0) > 0) {
    return { ok: false, error: "좌석이 있는 방은 좌석 배치도 화면에서 삭제하세요." };
  }
  await db.query(`delete from staff_schedule where room_id=$1 and branch_id=$2`, [id, branch]);
  await db.query(`delete from room where id=$1 and branch_id=$2`, [id, branch]);
  revalidatePath("/m/staff");
  revalidatePath("/m/seat");
  return { ok: true };
}
