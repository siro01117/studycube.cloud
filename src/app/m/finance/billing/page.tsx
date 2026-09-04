import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { todayKey } from "@/lib/date";
import PageHeader from "../../_shared/PageHeader";
import { getProducts, getStudentBillingOverview, getPayments } from "./actions";
import BillingView from "./BillingView";

export const runtime = "nodejs";

// 학원비 결제(상품·결제·수강기간) — /m/finance 의 하위 화면. MODULE_ROUTES 의 "payment" 모듈이 이미
// /m/finance 를 가리키므로(src/lib/modules.ts, 이 작업은 그 파일을 건드리지 않는다) 이 화면은 재무제표
// 안에서 링크로만 진입한다(FinanceView.tsx 상단 "학원비 결제 관리" 버튼).
// 폭 1080 — 결제 내역 표(학생·상품·정가·실납·차액·수단·기간·사유·메모·기록자)가 열이 많아 finance
// 본문(1000)보다 넓게 잡았다(목록 화면 확정폭 1080 과 맞춤, DESIGN.md §1).
const WIDTH = 1080;

export default async function BillingPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  if (!can(me, "billing.view")) redirect("/home");

  const [products, overview, recentPayments] = await Promise.all([
    getProducts(),
    getStudentBillingOverview(),
    getPayments({}),
  ]);

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader backHref="/m/finance" backLabel="재무제표" title="학원비 결제" flexNone />
      <BillingView
        products={products}
        overview={overview}
        payments={recentPayments}
        canManage={can(me, "billing.manage")}
        todayIso={todayKey()}
        width={WIDTH}
      />
    </main>
  );
}
