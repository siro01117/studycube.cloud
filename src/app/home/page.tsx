import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { MODULE_ROUTES } from "@/lib/modules";

export const runtime = "nodejs";

// 홈 = 운영의 중심인 '좌석 배치도'로 착지. (포털 카드 나열 X)
// 좌석 권한 없으면 접근 가능한 첫 모듈로, 그것도 없으면 안내.
export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();

  if (can(me, "seat.view")) redirect("/m/seat");

  const { rows } = await db.query<{ key: string; requires: string[] }>(
    // requires: text[] → jsonb (드라이버 배열 파서는 접속마다 타입 조회 왕복이 필요, json 은 내장)
    `select m.key, coalesce(to_jsonb(m.requires), '[]'::jsonb) as requires from module m
       join branch_module bm on bm.module_key = m.key
      where bm.branch_id = $1 and bm.enabled = true
      order by m.ord`,
    [me.activeBranchId],
  );
  const landing = rows.find(
    (m) => MODULE_ROUTES[m.key] && (me.isCto || (m.requires ?? []).every((p) => me.perms.includes(p))),
  );
  if (landing) redirect(MODULE_ROUTES[landing.key]);

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
      <div className="card" style={{ padding: 32, textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>이용 가능한 모듈이 없습니다</div>
        <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 6 }}>
          {me.name} 님 계정에 배정된 모듈이 없어요. 관리자에게 권한을 요청하세요.
        </div>
      </div>
    </main>
  );
}
