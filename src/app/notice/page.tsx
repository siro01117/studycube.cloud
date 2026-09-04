import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { dateTimeLabel } from "@/lib/date";
import MobileNotice, { type MNotice } from "./MobileNotice";

export const runtime = "nodejs";
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 폰용 공지 — 안 읽은 공지·중요 공지가 위로 오는 리스트. 열면 읽음 처리.
export default async function MobileNoticePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "notice.view")) redirect("/home");
  await ready();
  const branch = me.activeBranchId;

  // 사진은 id만(바이너리는 안 실어 보냄) — 상관 서브쿼리로 한 왕복에 같이 담아 N+1을 피한다.
  const { rows } = await db.query<{
    id: string; title: string; body: string; important: boolean; created_at: string;
    author_name: string | null; is_read: boolean; images: { id: string }[];
  }>(
    `select n.id, n.title, n.body, n.important, n.created_at::text as created_at,
            p.name as author_name, (nr.person_id is not null) as is_read,
            coalesce(
              (select json_agg(json_build_object('id', ni.id) order by ni.position)
                 from notice_image ni where ni.notice_id = n.id),
              '[]'
            ) as images
       from notice n
       left join person p on p.id = n.author_id
       left join notice_read nr on nr.notice_id = n.id and nr.person_id = $2
      where n.branch_id = $1 and n.audience = 'staff'
      order by is_read asc, n.important desc, n.created_at desc`,
    [branch, me.id],
  );

  const notices: MNotice[] = rows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    important: n.important,
    authorName: n.author_name ?? "탈퇴한 직원",
    createdLabel: dateTimeLabel(n.created_at),
    isRead: n.is_read,
    images: n.images,
  }));

  return <MobileNotice notices={notices} />;
}
