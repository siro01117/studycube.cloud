// 마감 자동 처리 — 그날 입실 없는 재원생을 무단결석으로 확정.
// Vercel Cron 이 매일 정해진 시각(vercel.json)에 GET 으로 호출한다.
// 보안: CRON_SECRET 환경변수를 설정하면 Vercel 이 Authorization: Bearer <secret> 로 부른다.
import { NextResponse } from "next/server";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/date";
import { processUnexcusedAbsences } from "@/lib/attendance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // 운영에선 반드시 시크릿으로 보호(미설정이면 명확히 거부해 열린 채로 방치되지 않게).
  if (process.env.NODE_ENV === "production") {
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET 미설정 — Vercel 환경변수에 추가하세요." },
        { status: 500 },
      );
    }
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  await ready();
  const date = todayKey(); // KST 오늘
  const branches = await db.query<{ id: string }>(`select id from branch where active = true`);
  const per: Record<string, number> = {};
  let total = 0;
  for (const b of branches.rows) {
    const r = await processUnexcusedAbsences(b.id, date);
    per[b.id] = r.marked;
    total += r.marked;
  }
  return NextResponse.json({ ok: true, date, total, per });
}
