import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import PageHeader from "../_shared/PageHeader";
import { getDevices } from "./actions";
import EntranceView from "./EntranceView";

export const runtime = "nodejs";

// 입구 태블릿(출입 키패드) 기기 발급·관리. sms 화면(/m/sms) 옆의 새 자리 — 기존 관리 섹션(학생·
// 좌석 등) 밑에 끼워 넣기보다 독립 모듈로 뺐다: 여기서 다루는 대상은 "학생"도 "직원"도 아니라
// 물리적으로 세워둔 기기이고, 발급되는 URL+토큰은 재발급하면 즉시 과거 값이 무효화되는 민감한
// 자격증명이라(perms.ts entrance.manage 주석) sms 발송함과 같은 "무인 인프라" 축으로 CTO 전용이다.
const WIDTH = 900;

export default async function EntrancePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  if (!can(me, "entrance.manage")) redirect("/home");

  const devices = await getDevices();

  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <PageHeader backHref="/home" backLabel="대시보드" title="입구 기기" flexNone maxWidth={WIDTH} />
      <EntranceView devices={devices} width={WIDTH} />
    </main>
  );
}
