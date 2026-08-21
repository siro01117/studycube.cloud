import "server-only";

// 스케쥴 입력 기간 판정 — 조회(DB) 담당. 판정 자체(순수 로직)는 schedule-window.ts.
// 학생 1명 기준 쿼리 3개(첫 제출 시각·windows·grants)로 끝난다 — 목록 화면(관리자 제출 현황)처럼
// 여러 학생을 한 번에 봐야 할 때는 이 함수를 학생마다 부르지 말고, windowActions.ts 처럼 windows/grants
// 를 한 번만 불러온 뒤 evaluateEdit 을 학생마다 메모리에서 돌려라(DB 왕복 없이).
import { db } from "./db";
import { evaluateEdit, formatEditState, type EditState, type TimeRange } from "./schedule-window";

type SubmissionLookupRow = {
  payload: Record<string, unknown>;
  first_submitted_at: string | null;
  created_at: string;
  status: string;
  note: string | null;
};
type RangeRow = { opens_at: string; closes_at: string };

export type EditResolution = {
  state: EditState;
  /** 이 학생의 마지막 제출 payload(스케쥴 폼이 저장한 그대로) — 없으면 한 번도 제출한 적 없음. */
  lastPayload: Record<string, unknown> | null;
  /** 마지막 제출 시각(가장 최근 제출/수정) — KST 라벨은 호출부가 date.ts 로 직접 포맷할 것. */
  lastSubmittedAt: string | null;
  /** 마지막 제출의 처리 상태(pending/done/rejected) — 없으면(한 번도 제출한 적 없음) null. */
  lastStatus: "pending" | "done" | "rejected" | null;
  /** 반려 사유(있다면) — 관리자 화면(m/schedule "제출 반영")의 반려 note 그대로. */
  lastNote: string | null;
};

const toRange = (r: RangeRow): TimeRange => ({ opensAt: new Date(r.opens_at), closesAt: new Date(r.closes_at) });

/** 한 학생의 스케쥴 입력 기간 판정 — type/slug 는 submission.type 과 payload->>'_slug' (여러 폼이 같은
 *  type 을 공유할 가능성을 대비해 slug 까지 맞춘다 — actions.ts submitForm 의 재제출 조회와 동일 관례). */
export async function resolveEditState(
  branchId: string,
  studentId: string,
  type: string,
  slug: string,
  now: Date = new Date(),
): Promise<EditResolution> {
  const [subRows, windowRows, grantRows] = await Promise.all([
    db.query<SubmissionLookupRow>(
      `select payload, first_submitted_at, created_at, status, note
         from submission
        where branch_id=$1 and student_id=$2 and type=$3 and payload->>'_slug'=$4
        order by created_at desc limit 1`,
      [branchId, studentId, type, slug],
    ),
    db.query<RangeRow>(`select opens_at, closes_at from schedule_window where branch_id=$1`, [branchId]),
    db.query<RangeRow>(`select opens_at, closes_at from schedule_grant where branch_id=$1 and student_id=$2`, [
      branchId,
      studentId,
    ]),
  ]);

  const sub = subRows.rows[0] ?? null;
  const firstSubmittedAt = sub?.first_submitted_at ? new Date(sub.first_submitted_at) : null;
  const windows = windowRows.rows.map(toRange);
  const grants = grantRows.rows.map(toRange);

  const decision = evaluateEdit({ now, firstSubmittedAt, windows, grants });
  return {
    state: formatEditState(decision, now),
    lastPayload: sub?.payload ?? null,
    lastSubmittedAt: sub ? sub.created_at : null,
    lastStatus: sub ? (sub.status as "pending" | "done" | "rejected") : null,
    lastNote: sub?.note ?? null,
  };
}
