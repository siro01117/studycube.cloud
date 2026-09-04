import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { dateTimeLabel, todayKey } from "@/lib/date";
import SubmissionList, { type SubmissionRow } from "./SubmissionList";
import PageHeader from "../_shared/PageHeader";

export const runtime = "nodejs";

export default async function SubmissionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; date?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect("/login");
  // 응답 조회 전용 권한이 perms.ts 에 없어 student.view 를 재사용(보고 대상).
  if (!can(me, "student.view")) redirect("/home");
  await ready();
  const canManage = can(me, "student.edit"); // 상태 변경도 별도 권한이 없어 student.edit 재사용.
  const branch = me.activeBranchId;

  const sp = await searchParams;
  const typeFilter = sp.type || "";
  const dateFilter = sp.date || "";

  const [types, rows] = await Promise.all([
    db.query<{ type: string }>(`select distinct type from submission where branch_id=$1 order by type`, [branch]),
    (async () => {
      const conds = ["sub.branch_id=$1"];
      const params: unknown[] = [branch];
      if (typeFilter) {
        params.push(typeFilter);
        conds.push(`sub.type=$${params.length}`);
      }
      if (dateFilter) {
        params.push(dateFilter);
        // created_at 은 timestamptz(UTC 저장) → KST 로 변환한 날짜로 비교(자정 근처 하루 밀림 방지).
        conds.push(`(sub.created_at at time zone 'Asia/Seoul')::date = $${params.length}::date`);
      }
      return db.query<SubmissionRow>(
        `select sub.id, sub.type, sub.payload, sub.status, sub.note,
                sub.submitter_name, sub.submitter_phone,
                sub.created_at as created_at_raw,
                st.name as student_name, se.number as seat_number
           from submission sub
           left join student st on st.id = sub.student_id
           left join seat se on se.current_student_id = st.id and se.branch_id = sub.branch_id
          where ${conds.join(" and ")}
          order by sub.created_at desc
          limit 200`,
        params,
      );
    })(),
  ]);

  // created_at 은 서버(KST 라벨)에서 미리 문자열로 변환해 내려준다 — 클라 렌더에서 new Date() 금지 원칙.
  const list: (SubmissionRow & { created_at_label: string })[] = rows.rows.map((r) => ({
    ...r,
    created_at_label: dateTimeLabel(r.created_at_raw as unknown as string),
  }));

  return (
    <main style={{ minHeight: "100dvh" }}>
      <PageHeader
        backHref="/home"
        backLabel="대시보드"
        title="신청·설문 응답"
        maxWidth
        right={<div style={{ fontSize: 12.5, color: "var(--sub)" }}>최근 {list.length}건</div>}
      />
      <div className="mx-auto max-w-[1080px] px-5 py-5">
        <SubmissionList
          rows={list}
          types={types.rows.map((t) => t.type)}
          typeFilter={typeFilter}
          dateFilter={dateFilter}
          today={todayKey()}
          canManage={canManage}
        />
      </div>
    </main>
  );
}
