import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { MODULE_ROUTES } from "@/lib/modules";
import NavRail from "./NavRail";
import type { NavModule } from "./NavRail";

export const runtime = "nodejs";

// 모든 /m/* 모듈 페이지 공통 셸 — 좌측 상시 내비 레일 + 본문.
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();

  const { rows } = await db.query<{ key: string; label: string; requires: string[]; ord: number }>(
    // requires 는 text[] 지만 jsonb 로 받는다 — 드라이버의 배열 파서는 접속마다
    // 타입 조회 왕복을 요구하는데(fetch_types), json 파서는 기본 내장이라 왕복이 없다.
    `select m.key, m.label, coalesce(to_jsonb(m.requires), '[]'::jsonb) as requires, m.ord from module m
       join branch_module bm on bm.module_key = m.key
      where bm.branch_id = $1 and bm.enabled = true
      order by m.ord`,
    [me.activeBranchId],
  );
  const modules: NavModule[] = rows
    .filter((m) => me.isCto || (m.requires ?? []).every((p) => me.perms.includes(p)))
    .map((m) => ({ key: m.key, label: m.label, href: MODULE_ROUTES[m.key] ?? null }));

  return (
    <div style={{ display: "flex", minHeight: "100dvh" }}>
      <NavRail modules={modules} me={{ name: me.name, isCto: me.isCto }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
