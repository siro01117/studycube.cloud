import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import PageHeader from "../_shared/PageHeader";
import { getSmsMessages } from "./actions";
import { getSmsTemplates } from "./templateActions";
import SmsList from "./SmsList";
import TemplatesView from "./TemplatesView";

export const runtime = "nodejs";

// 문자 발송함 — 직원·재무·급여와 같은 "직원·운영" 축(modules.ts category="staff")에 두되, 공지·재무
// 옆이 아니라 새 자리(/m/sms)로 뺐다. 근거: 공지는 "무슨 내용을 보이나"(콘텐츠), 재무는 "돈이 얼마
// 들어오고 나갔나"(장부)를 다루는 화면이고, 여기는 "그 결과로 실제 통신사 문자가 나갔는지"를 다루는
// 인프라 성격의 화면이라 성격이 다르다. 공지 문자 병행 발송(notice_broadcast)처럼 나중에 여러 화면이
// 이 큐를 같이 쓰게 되므로 어느 한 기능(공지/재무) 밑에 종속시키지 않는 편이 더 맞다.
// 권한: sms.view/sms.manage — 건당 실비가 나가고 학부모에게 직접 닿아 billing.*/payroll.* 와 같은
// 축으로 CTO 전용이다(ADMIN_PERM_KEYS 에서 의도적으로 제외, bootstrap.ts).
const WIDTH = 1080;

export default async function SmsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  if (!can(me, "sms.view")) redirect("/home");

  const sp = await searchParams;
  const tab = sp.tab === "sent" || sp.tab === "failed" || sp.tab === "templates" ? sp.tab : "pending";
  const canManage = can(me, "sms.manage");

  if (tab === "templates") {
    const { rows: templateRows, expiryDailyTime, workerSecretMeta } = await getSmsTemplates();
    return (
      <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <PageHeader backHref="/home" backLabel="대시보드" title="문자 발송함" flexNone maxWidth={WIDTH} />
        <SmsList
          rows={[]}
          tab={tab}
          canManage={canManage}
          width={WIDTH}
          templatesNode={
            <TemplatesView
              rows={templateRows}
              expiryDailyTime={expiryDailyTime}
              workerSecretMeta={workerSecretMeta}
              canManage={canManage}
            />
          }
        />
      </main>
    );
  }

  const rows = await getSmsMessages(tab);
  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <PageHeader backHref="/home" backLabel="대시보드" title="문자 발송함" flexNone maxWidth={WIDTH} />
      <SmsList rows={rows} tab={tab} canManage={canManage} width={WIDTH} />
    </main>
  );
}
