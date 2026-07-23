import "server-only";
import { db } from "./db";
import { PENALTY_BY_KEY } from "./penalty";

// 마감 시 '무단결석' 일괄 처리 (시스템/크론에서 호출 — 로그인 세션 없음, 호출부가 인증).
//
// 규칙: 그날 입실(check-in)이 한 번도 없고, 아직 일일 출결 상태(attendance)가 없는
//       재원생 = 실제로 안 온 것 → 하루 통째로 '무단결석(unexcused)'으로 확정.
//   · 늦게라도 체크인한 학생(지각)은 입실 기록이 있으므로 자동 제외.
//   · 이미 병결/사유결 등으로 처리된 학생도 제외(덮어쓰지 않음).
// 확정 시:
//   1) 그날 순찰의 잠정 '지각'(state='late') 마크 삭제 → 무단결석 하나로 통합.
//   2) 무단결석 벌점(프리셋 absent=3점) 부여(같은 날 중복 방지).
export async function processUnexcusedAbsences(branchId: string, date: string): Promise<{ marked: number }> {
  // 1) 대상 확정 + 일일 상태 기록을 한 번에. 새로 넣은 학생 id 만 반환.
  const marked = await db.query<{ student_id: string }>(
    `insert into attendance(branch_id, student_id, date, status, reason)
     select $1, s.id, $2, 'absent', 'unexcused'
       from student s
      where s.branch_id=$1 and s.status='enrolled'
        and not exists (select 1 from attendance_event ae
                          where ae.student_id=s.id and ae.branch_id=$1 and ae.date=$2 and ae.kind='in')
        and not exists (select 1 from attendance a
                          where a.student_id=s.id and a.branch_id=$1 and a.date=$2)
     on conflict (student_id, date) do nothing
     returning student_id`,
    [branchId, date],
  );
  const ids = marked.rows.map((r) => r.student_id);
  if (ids.length === 0) return { marked: 0 };
  const idArr = "{" + ids.join(",") + "}"; // fetch_types:false → 배열은 리터럴 문자열로 전달

  // 2) 그날 잠정 '지각' 순찰 마크 삭제(무단결석 하나로 통합)
  await db.query(
    `delete from patrol_event
      where branch_id=$1 and date=$2 and state='late' and student_id = any($3::uuid[])`,
    [branchId, date, idArr],
  );

  // 3) 무단결석 벌점 부여(같은 날 같은 사유가 이미 있으면 건너뜀)
  const pts = PENALTY_BY_KEY["absent"]?.points ?? 3;
  await db.query(
    `insert into penalty_event(branch_id, student_id, reason, points, date, note)
     select $1, sid, 'absent', $4, $2, '마감 자동 처리'
       from unnest($3::uuid[]) as sid
      where not exists (select 1 from penalty_event pe
                          where pe.student_id=sid and pe.branch_id=$1 and pe.date=$2 and pe.reason='absent')`,
    [branchId, date, idArr, pts],
  );

  return { marked: ids.length };
}
