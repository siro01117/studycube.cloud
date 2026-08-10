"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { PATROL_BY_KEY } from "@/lib/patrol";
import { todayKey as todayStr } from "@/lib/date"; // KST 기준(서버 UTC 어긋남 방지)

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

// 순찰에서 '입석(seated)'으로 찍힌 학생 → 출결 입실 연동.
// 그날 마지막 출결 이벤트가 이미 in 이면 no-op(중복 방지). out 이거나 기록이 없을 때만 in 추가.
// attendance_event 에는 source/note 컬럼이 없어(스키마 변경 금지) auto=true 로 "순찰발 자동 입실"임을 남긴다
// (수동 checkIn 은 auto=false로 기록되므로 구분 가능).
async function ensureCheckedInFromPatrol(branchId: string | null, studentId: string, date: string, by: string) {
  const last = await db.query<{ kind: string }>(
    `select kind from attendance_event where student_id=$1 and branch_id=$2 and date=$3 order by at desc limit 1`,
    [studentId, branchId, date],
  );
  if (last.rows[0]?.kind === "in") return;
  await db.query(
    `insert into attendance_event(branch_id, student_id, kind, auto, date, created_by)
     values ($1,$2,'in',true,$3,$4)`,
    [branchId, studentId, date, by],
  );
}

// 순찰 상태 원탭 기록. points 는 프리셋에서 스냅샷 → 나중에 프리셋 바꿔도 과거 기록 불변.
// 한 순찰 세션(sessionId) 안에서는 학생당 상태 1개 → 재탭하면 기존 걸 지우고 교체.
export async function recordPatrol(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("studentId"));
  const state = s(formData.get("state"));
  const sessionId = s(formData.get("sessionId"));
  if (!id || !state) return;
  const preset = PATROL_BY_KEY[state];
  if (!preset) return;
  // 기록 당시 앉아있던 좌석 스냅샷
  const seatRow = await db.query<{ id: string }>(
    `select id from seat where current_student_id=$1 and branch_id=$2 limit 1`,
    [id, me.activeBranchId],
  );
  const seatId = seatRow.rows[0]?.id ?? null;
  const date = todayStr();
  if (sessionId) {
    // 같은 세션 내 이 학생 기존 기록 제거(교체)
    await db.query(
      `delete from patrol_event where student_id=$1 and branch_id=$2 and session_id=$3`,
      [id, me.activeBranchId, sessionId],
    );
  }
  await db.query(
    `insert into patrol_event(branch_id, student_id, state, points, session_id, seat_id, date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [me.activeBranchId, id, state, preset.points, sessionId, seatId, date, me.id],
  );
  if (state === "seated") {
    await ensureCheckedInFromPatrol(me.activeBranchId, id, date, me.id);
  }
  revalidatePath("/m/seat");
}

// 여러 학생 상태를 한 번에 기록 (모바일 순찰의 '이 방 완료' — 미점검 좌석을 일괄 입석 처리).
// 학생 27명이면 개별 호출 시 왕복 100회 이상 → 단일 왕복으로 줄인다. 세션당 학생 1상태(교체) 규칙은 동일.
export async function recordPatrolBulk(formData: FormData) {
  const me = await guard("patrol.manage");
  const sessionId = s(formData.get("sessionId"));
  let items: { studentId: string; state: string }[];
  try {
    items = JSON.parse(s(formData.get("items")) ?? "[]");
  } catch { return; }
  if (!Array.isArray(items) || items.length === 0) return;

  // 유효 상태만 통과 + 학생 중복 제거(뒤엣것 우선)
  const byStudent = new Map<string, string>();
  for (const it of items) {
    if (!it?.studentId || !PATROL_BY_KEY[it?.state]) continue;
    byStudent.set(it.studentId, it.state);
  }
  if (byStudent.size === 0) return;

  // 좌석 스냅샷 — 지점 좌석은 100석 내외라 통째로 읽고 메모리에서 매칭(배열 파라미터 회피)
  const seatRows = await db.query<{ id: string; current_student_id: string }>(
    `select id, current_student_id from seat where branch_id=$1 and current_student_id is not null`,
    [me.activeBranchId],
  );
  const seatOf = new Map(seatRows.rows.map((r) => [r.current_student_id, r.id]));
  const ids = [...byStudent.keys()];
  const date = todayStr();

  // 같은 세션의 기존 기록 제거(교체)
  if (sessionId) {
    const ph = ids.map((_, i) => `$${i + 3}`).join(",");
    await db.query(
      `delete from patrol_event where branch_id=$1 and session_id=$2 and student_id in (${ph})`,
      [me.activeBranchId, sessionId, ...ids],
    );
  }

  const params: (string | number | null)[] = [me.activeBranchId, sessionId, date, me.id];
  const values = ids.map((id) => {
    const state = byStudent.get(id)!;
    const i = params.length;
    params.push(id, state, PATROL_BY_KEY[state].points, seatOf.get(id) ?? null);
    return `($1,$${i + 1},$${i + 2},$${i + 3},$2,$${i + 4},$3,$4)`;
  });
  await db.query(
    `insert into patrol_event(branch_id, student_id, state, points, session_id, seat_id, date, created_by)
     values ${values.join(",")}`,
    params,
  );

  // 입석으로 찍힌 학생만 출결 입실 연동 — 학생별 루프 쿼리 없이 조회 1회 + insert 1회로 처리.
  const seatedIds = ids.filter((id) => byStudent.get(id) === "seated");
  if (seatedIds.length > 0) {
    const seatedArr = "{" + seatedIds.join(",") + "}"; // fetch_types:false → 배열은 리터럴 문자열로 전달
    const lastAtt = await db.query<{ student_id: string; kind: string }>(
      `select distinct on (student_id) student_id, kind
         from attendance_event
        where branch_id=$1 and date=$2 and student_id = any($3::uuid[])
        order by student_id, at desc`,
      [me.activeBranchId, date, seatedArr],
    );
    const lastKind = new Map(lastAtt.rows.map((r) => [r.student_id, r.kind]));
    const needCheckIn = seatedIds.filter((id) => lastKind.get(id) !== "in");
    if (needCheckIn.length > 0) {
      const attParams: (string | boolean | null)[] = [me.activeBranchId, date, me.id];
      const attValues = needCheckIn.map((id) => {
        attParams.push(id);
        return `($1,$${attParams.length},'in',true,$2,$3)`;
      });
      await db.query(
        `insert into attendance_event(branch_id, student_id, kind, auto, date, created_by)
         values ${attValues.join(",")}`,
        attParams,
      );
    }
  }

  revalidatePath("/m/seat");
}

// 순찰 이벤트 1건 삭제 (벌점 내역에서 정정 — id로)
export async function removePatrolEvent(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("id"));
  if (!id) return;
  await db.query(`delete from patrol_event where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/penalty");
  revalidatePath("/m/patrol");
  revalidatePath("/m/seat");
}

// 마지막 순찰 기록 취소 (오탭 정정)
export async function undoLastPatrol(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("studentId"));
  if (!id) return;
  await db.query(
    `delete from patrol_event
      where id = (select id from patrol_event
                   where student_id=$1 and branch_id=$2 and date=$3
                   order by at desc limit 1)`,
    [id, me.activeBranchId, todayStr()],
  );
  revalidatePath("/m/seat");
}

// 순찰 시작 — 세션 행 생성(시작 시각 기록). id 는 클라가 생성해 patrol_event 와 매칭.
export async function startPatrol(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("sessionId"));
  if (!id) return;
  await db.query(
    `insert into patrol_session(id, branch_id, date, created_by) values ($1,$2,$3,$4)
     on conflict (id) do nothing`,
    [id, me.activeBranchId, todayStr(), me.id],
  );
  revalidatePath("/m/seat");
}

// 순찰 종료 — 종료 시각 기록
export async function endPatrol(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("sessionId"));
  if (!id) return;
  await db.query(
    `update patrol_session set ended_at=now() where id=$1 and branch_id=$2 and ended_at is null`,
    [id, me.activeBranchId],
  );
  revalidatePath("/m/seat");
}

// 순찰 세션 삭제 (오시작·테스트 정정) — 세션 행 + 그 세션의 순찰 기록 함께 삭제
export async function deletePatrolSession(formData: FormData) {
  const me = await guard("patrol.manage");
  const id = s(formData.get("sessionId"));
  if (!id) return;
  await db.query(`delete from patrol_event where session_id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  await db.query(`delete from patrol_session where id=$1 and branch_id=$2`, [id, me.activeBranchId]);
  revalidatePath("/m/seat");
}

// 순찰 이력 — 세션별 시각 + 점검 인원 + 벌점 합계
export async function getPatrolSessions() {
  const me = await guard("patrol.view");
  const r = await db.query<{ id: string; started_at: string; ended_at: string | null; marked: number; penalty: number }>(
    `select ps.id, ps.started_at::text as started_at, ps.ended_at::text as ended_at,
            count(pe.id)::int as marked, coalesce(sum(pe.points),0)::int as penalty
       from patrol_session ps
       left join patrol_event pe on pe.session_id = ps.id
      where ps.branch_id=$1
      group by ps.id
      order by ps.started_at desc
      limit 60`,
    [me.activeBranchId],
  );
  return r.rows;
}

// 한 순찰 세션의 학생별 기록 (student_id 포함 → 좌석 매핑·수정용)
export async function getPatrolSessionDetail(sessionId: string) {
  const me = await guard("patrol.view");
  const r = await db.query<{ student_id: string; seat_id: string | null; name: string; state: string; points: number; at: string }>(
    `select pe.student_id, pe.seat_id, st.name, pe.state, pe.points, pe.at::text as at
       from patrol_event pe join student st on st.id = pe.student_id
      where pe.session_id=$1 and pe.branch_id=$2
      order by pe.at`,
    [sessionId, me.activeBranchId],
  );
  return r.rows;
}

// 지난 순찰 기록 수정 — 특정 세션에서 학생 상태를 바꾸거나 새로 찍음(세션당 1상태, 교체).
// date 는 그 세션의 날짜로 맞춤(오늘이 아닐 수 있음).
export async function setPatrolMark(formData: FormData) {
  const me = await guard("patrol.manage");
  const sessionId = s(formData.get("sessionId"));
  const id = s(formData.get("studentId"));
  const state = s(formData.get("state"));
  const seatId = s(formData.get("seatId")); // 수정 대상 좌석(클릭한 자리) — 스냅샷 유지
  if (!sessionId || !id || !state) return;
  const preset = PATROL_BY_KEY[state];
  if (!preset) return;
  const sess = await db.query<{ date: string }>(
    `select date::text as date from patrol_session where id=$1 and branch_id=$2`,
    [sessionId, me.activeBranchId],
  );
  const date = sess.rows[0]?.date ?? todayStr();
  await db.query(
    `delete from patrol_event where student_id=$1 and branch_id=$2 and session_id=$3`,
    [id, me.activeBranchId, sessionId],
  );
  await db.query(
    `insert into patrol_event(branch_id, student_id, state, points, session_id, seat_id, date, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [me.activeBranchId, id, state, preset.points, sessionId, seatId, date, me.id],
  );
  if (state === "seated") {
    await ensureCheckedInFromPatrol(me.activeBranchId, id, date, me.id);
  }
  revalidatePath("/m/patrol");
  revalidatePath("/m/seat");
}

// 지난 순찰 기록에서 학생 상태 지우기(오탭 삭제)
export async function clearPatrolMark(formData: FormData) {
  const me = await guard("patrol.manage");
  const sessionId = s(formData.get("sessionId"));
  const id = s(formData.get("studentId"));
  if (!sessionId || !id) return;
  await db.query(
    `delete from patrol_event where student_id=$1 and branch_id=$2 and session_id=$3`,
    [id, me.activeBranchId, sessionId],
  );
  revalidatePath("/m/patrol");
  revalidatePath("/m/seat");
}

// 특정 학생·날짜 순찰 기록 (팝업용)
export async function getPatrolEvents(studentId: string, date: string) {
  const me = await guard("patrol.view");
  const r = await db.query<{ state: string; points: number; at: string }>(
    `select state, points, at::text as at
       from patrol_event
      where student_id=$1 and branch_id=$2 and date=$3
      order by at`,
    [studentId, me.activeBranchId, date],
  );
  return r.rows;
}
