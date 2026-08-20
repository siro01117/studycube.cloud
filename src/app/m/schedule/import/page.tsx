import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import ImportView from "./ImportView";
import { loadImportBase } from "./actions";

export const runtime = "nodejs";

// 스케줄 JSON 업로드 → 미리보기 → 부분 적용 — src/app/m/schedule/page.tsx(ScheduleDemo)와 완전히
// 독립된 라우트. 스키마·SCHEDULE_VERSION 변경 없이 기존 schedule_hours/schedule_rule 만 다룬다.
export default async function ScheduleImportPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "schedule.manage")) redirect("/m/schedule");
  await ready();

  const base = await loadImportBase();

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", flex: "none" }}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/m/schedule" className="chip" style={{ textDecoration: "none" }}>‹ 스케쥴러</Link>
            <span style={{ fontWeight: 700 }}>스케줄 JSON 일괄 반영</span>
          </div>
          <div className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>재원생 {base.students.length}명</div>
        </div>
      </header>

      <ImportView base={base} />
    </main>
  );
}
