import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { todayKey } from "@/lib/date";
import { shiftMonth, monthLabel } from "@/lib/finance";
import PageHeader from "../_shared/PageHeader";
import { getMonthData } from "./actions";
import FinanceView from "./FinanceView";

export const runtime = "nodejs";

// 재무제표(수입·지출 장부) — MODULE_ROUTES 등록은 이 화면의 몫이 아니다(집주인이 직접 연결).
// 폭 1000 — 도시락 월설정(950)·직원 근무표(980)보다 살짝 넓다: 이 화면은 그 화면들과 달리 상단에
// 요약 카드 3장 + 추이 차트가 표 위에 얹혀서 표 자체의 실제 열 폭 요구가 조금 더 크다.
const WIDTH = 1000;

const YM_RE = /^\d{1,2}$/;

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  if (!can(me, "billing.view")) redirect("/home");

  const sp = await searchParams;
  const today = todayKey();
  const [ty, tm] = today.split("-").map(Number);
  let year = Number(sp.y) || ty;
  let month = Number(sp.m) || tm;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) year = ty;
  if (!sp.m || !YM_RE.test(sp.m) || month < 1 || month > 12) month = tm;

  const data = await getMonthData(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const canManageGeneral = can(me, "billing.manage");
  const canManagePayroll = can(me, "payroll.manage");

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader
        backHref="/home" backLabel="대시보드" title="재무제표" flexNone
        right={
          !canManageGeneral && !canManagePayroll && (
            <div className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>조회 전용</div>
          )
        }
      />
      <FinanceView
        data={data}
        prevHref={`/m/finance?y=${prev.year}&m=${prev.month}`}
        nextHref={`/m/finance?y=${next.year}&m=${next.month}`}
        monthLabelText={monthLabel(year, month)}
        canManageGeneral={canManageGeneral}
        canManagePayroll={canManagePayroll}
        width={WIDTH}
      />
    </main>
  );
}
