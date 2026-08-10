"use server";

// 엑셀(학생 스케줄표) -> schedule_hours(자습) + schedule_rule(외부 학원) 일회성 임포트.
// parse_schedule.py 가 생성한 파싱 결과를 src/data/schedule-seed.ts 에 인라인한 것을 읽어
// 이름으로 재원생과 매칭한다.
// - kind==="study" 항목: schedule_hours 로. 같은 요일이 여러 항목에 걸치면 가장 이른 등원·가장 늦은 하원으로 병합.
// - kind==="academy" 항목: 기존대로 schedule_rule(reason='외부 학원').
// 매칭된 학생의 기존 schedule_hours 전부 + schedule_rule 중 kind in ('study','academy') 를 지운 뒤 새로 깐다(다른 사유·임시 일정은 보존).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth";
import { SCHEDULE_SEED } from "@/data/schedule-seed";

type ImportKind = "study" | "academy";
type ImportItem = { kind: ImportKind; reason: string; days: number[]; start: number; end: number };
type ImportStudent = { sheet: string; seat: number; name: string; items: ImportItem[] };
type ImportJson = { students: ImportStudent[]; warnings: unknown[] };

export type ImportResult = { inserted: number; hoursInserted: number; students: number; unmatched: string[]; warnings: number };

export async function importFromSheet(): Promise<ImportResult> {
  const me = await guard("schedule.manage");
  const branchId = me.activeBranchId;
  if (!branchId) throw new Error("소속 지점을 확인할 수 없습니다");

  const parsed: ImportJson = SCHEDULE_SEED;
  if (!parsed || !Array.isArray(parsed.students)) throw new Error("파싱 결과 형식이 올바르지 않습니다");

  // 현재 지점 재원생을 이름으로 매칭(좌석번호는 매칭 기준으로 쓰지 않음, 참고용 교차검증만).
  const roster = await db.query<{ id: string; name: string }>(
    `select id, name from student where branch_id=$1 and status='enrolled'`,
    [branchId],
  );
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const r of roster.rows) {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  }

  const unmatched: string[] = [];
  const matchedStudentIds: string[] = [];
  // 실제로 넣을 외부 학원 (student_id, item) 쌍
  const ruleRows: { studentId: string; item: ImportItem }[] = [];
  // 자습(등하원) 병합용: studentId -> day -> {arrive,leave}
  const hoursByStudent = new Map<string, Map<number, { arrive: number; leave: number }>>();

  for (const s of parsed.students) {
    const candidates = byName.get(s.name);
    if (!candidates || candidates.length === 0) {
      unmatched.push(`${s.name} (재원생 명단에 없음)`);
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push(`${s.name} (동명이인 ${candidates.length}명, 매칭 보류)`);
      continue;
    }
    if (s.items.length === 0) continue; // 파싱된 일정이 없으면 건드리지 않는다(경고로만 남음)

    const studentId = candidates[0].id;
    matchedStudentIds.push(studentId);
    for (const item of s.items) {
      if (!item.days.length || item.end <= item.start) continue;
      if (item.kind === "study") {
        let byDay = hoursByStudent.get(studentId);
        if (!byDay) { byDay = new Map(); hoursByStudent.set(studentId, byDay); }
        for (const day of item.days) {
          const cur = byDay.get(day);
          if (!cur) byDay.set(day, { arrive: item.start, leave: item.end });
          else byDay.set(day, { arrive: Math.min(cur.arrive, item.start), leave: Math.max(cur.leave, item.end) });
        }
      } else {
        ruleRows.push({ studentId, item });
      }
    }
  }

  const uniqueStudentIds = [...new Set(matchedStudentIds)];
  if (uniqueStudentIds.length === 0) {
    return { inserted: 0, hoursInserted: 0, students: 0, unmatched, warnings: parsed.warnings?.length ?? 0 };
  }

  // 매칭된 학생들의 기존 등하원 전부 + 자습·외부 학원 규칙만 삭제(다른 사유·임시 일정은 보존).
  {
    const params: string[] = [branchId];
    const placeholders = uniqueStudentIds.map((id) => {
      params.push(id);
      return `$${params.length}`;
    });
    await db.query(
      `delete from schedule_hours where branch_id=$1 and student_id in (${placeholders.join(",")})`,
      params,
    );
    await db.query(
      `delete from schedule_rule
        where branch_id=$1 and kind in ('study','academy') and student_id in (${placeholders.join(",")})`,
      params,
    );
  }

  // 등하원 단일 multi-row insert
  let hoursInserted = 0;
  {
    const params: (string | number)[] = [branchId];
    const values: string[] = [];
    for (const [studentId, byDay] of hoursByStudent) {
      for (const [day, { arrive, leave }] of byDay) {
        const base = params.length;
        params.push(studentId, day, arrive, leave);
        values.push(`($1,$${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
        hoursInserted++;
      }
    }
    if (values.length > 0) {
      await db.query(
        `insert into schedule_hours(branch_id, student_id, day, arrive_min, leave_min) values ${values.join(",")}`,
        params,
      );
    }
  }

  // 외부 학원 단일 multi-row insert
  if (ruleRows.length > 0) {
    const params: (string | number)[] = [branchId];
    const values: string[] = [];
    for (const { studentId, item } of ruleRows) {
      const daysCsv = [...new Set(item.days)].sort((a, b) => a - b).join(",");
      const base = params.length;
      params.push(studentId, item.reason, item.kind, "", item.start, item.end, daysCsv);
      values.push(`($1,$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    }
    await db.query(
      `insert into schedule_rule(branch_id, student_id, reason, kind, title, start_min, end_min, days)
       values ${values.join(",")}`,
      params,
    );
  }

  revalidatePath("/m/schedule");
  return { inserted: ruleRows.length, hoursInserted, students: uniqueStudentIds.length, unmatched, warnings: parsed.warnings?.length ?? 0 };
}
