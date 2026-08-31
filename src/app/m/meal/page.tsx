import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import MealDemo from "./MealDemo";
import PageHeader from "../_shared/PageHeader";

export const runtime = "nodejs";

// 도시락 관리 — 원본 Electron 앱("도시락앱")의 렌더러를 글자 그대로 이식한 데모 화면이다
// (src/app/m/meal/_demo/**, 원본: OneDrive/작업/도시락앱/src/renderer/src/**). 실제 DB 대신
// 브라우저 localStorage 어댑터(_demo/api.ts)로 동작하므로 서버에서 넘겨줄 연/월 데이터가 없다 —
// 권한 가드만 서버에서 확인하고 본문은 클라이언트 전용(next/dynamic ssr:false)으로 마운트한다.
// 구 미완성 화면(MealAdmin/OrderingTab/StatusTab/PaymentTab/SettingsTab, 커밋 안 됨)은 이 재작업으로 대체되어 삭제했다.
export default async function MealAdminPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "lunch.view")) redirect("/home");
  await ready();

  const canManage = can(me, "lunch.manage");

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader
        backHref="/home"
        backLabel="홈"
        title="도시락 관리"
        flexNone
        right={
          !canManage && (
            <div className="hide-mobile" style={{ fontSize: 12.5, color: "var(--dim)" }}>조회 전용</div>
          )
        }
      />

      <MealDemo />
    </main>
  );
}
