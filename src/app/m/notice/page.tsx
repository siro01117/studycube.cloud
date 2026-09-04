import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { dateTimeLabel } from "@/lib/date";
import PageHeader from "../_shared/PageHeader";
import PhoneRedirect from "../_shared/PhoneRedirect";
import NoticeList, { type NoticeRow } from "./NoticeList";

export const runtime = "nodejs";

export default async function NoticePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me, "notice.view")) redirect("/home");
  await ready();
  const canManage = can(me, "notice.manage");
  const canSms = can(me, "sms.manage"); // 공지 병행 발송 — sms.* 축, notice.manage 와 별개(집주인 지시)
  const branch = me.activeBranchId;

  // 직원 공지 읽음 현황은 명단까지(누가 읽었는지) 보여준다 — 직원 수가 적어 괜찮다.
  // 학생 공지는 명단을 내려주지 않는다(N+1도 아니고 학생 수 자체가 많아 "명단 나열"이 부담) — 대신
  // "N명 중 M명" 요약만 집계 쿼리(notice_student_read group by)로 계산한다.
  // 사진은 id만(바이너리는 안 실어 보냄) — 상관 서브쿼리로 한 왕복에 같이 담아 N+1을 피한다.
  // 전부 합쳐 5쿼리, 공지 개수와 무관(N+1 없음).
  const [notices, staffRoster, staffReads, studentTotal, studentReadCounts] = await Promise.all([
    db.query<{
      id: string; author_id: string | null; author_name: string | null; title: string; body: string; important: boolean;
      audience: "staff" | "student"; created_at: string; updated_at: string; images: { id: string }[];
    }>(
      `select n.id, n.author_id, p.name as author_name, n.title, n.body, n.important, n.audience,
              n.created_at::text as created_at, n.updated_at::text as updated_at,
              coalesce(
                (select json_agg(json_build_object('id', ni.id) order by ni.position)
                   from notice_image ni where ni.notice_id = n.id),
                '[]'
              ) as images
         from notice n left join person p on p.id = n.author_id
        where n.branch_id = $1
        order by n.created_at desc`,
      [branch],
    ),
    // 전 직원 명단(직원 공지 읽음 현황의 분모) — 이 지점에 배정된 사람 + CTO(전 지점 전권, person_role 행이 없다).
    db.query<{ id: string; name: string }>(
      `select id, name from person
        where active = true
          and (is_cto = true or id in (select person_id from person_role where branch_id=$1))
        order by name`,
      [branch],
    ),
    db.query<{ notice_id: string; person_id: string; person_name: string; read_at: string }>(
      `select nr.notice_id, nr.person_id, p.name as person_name, nr.read_at::text as read_at
         from notice_read nr
         join notice n on n.id = nr.notice_id
         join person p on p.id = nr.person_id
        where n.branch_id = $1 and n.audience = 'staff'
        order by nr.read_at`,
      [branch],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from student where branch_id = $1 and status = 'enrolled'`,
      [branch],
    ),
    db.query<{ notice_id: string; n: number }>(
      `select nsr.notice_id, count(*)::int as n
         from notice_student_read nsr
         join notice n on n.id = nsr.notice_id
        where n.branch_id = $1
        group by nsr.notice_id`,
      [branch],
    ),
  ]);

  const readByNotice = new Map<string, { personId: string; name: string; label: string }[]>();
  for (const r of staffReads.rows) {
    const arr = readByNotice.get(r.notice_id) ?? [];
    arr.push({ personId: r.person_id, name: r.person_name, label: dateTimeLabel(r.read_at) });
    readByNotice.set(r.notice_id, arr);
  }
  const studentReadByNotice = new Map(studentReadCounts.rows.map((r) => [r.notice_id, r.n]));
  const totalStudents = studentTotal.rows[0]?.n ?? 0;

  const rows: NoticeRow[] = notices.rows.map((n) => {
    if (n.audience === "student") {
      return {
        id: n.id,
        authorId: n.author_id,
        authorName: n.author_name ?? "탈퇴한 직원",
        title: n.title,
        body: n.body,
        important: n.important,
        audience: "student",
        createdAt: n.created_at,
        updatedAt: n.updated_at,
        createdLabel: dateTimeLabel(n.created_at),
        edited: n.updated_at !== n.created_at,
        updatedLabel: dateTimeLabel(n.updated_at),
        readCount: studentReadByNotice.get(n.id) ?? 0,
        total: totalStudents,
        readers: [],
        unreadNames: [],
        images: n.images,
      };
    }
    const readers = readByNotice.get(n.id) ?? [];
    const readIds = new Set(readers.map((r) => r.personId));
    return {
      id: n.id,
      authorId: n.author_id, // 복원(실행취소) 시 원 작성자 그대로 재기록하기 위함
      authorName: n.author_name ?? "탈퇴한 직원",
      title: n.title,
      body: n.body,
      important: n.important,
      audience: "staff",
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      createdLabel: dateTimeLabel(n.created_at),
      edited: n.updated_at !== n.created_at,
      updatedLabel: dateTimeLabel(n.updated_at),
      readCount: readers.length,
      total: staffRoster.rows.length,
      readers: readers.map((r) => ({ name: r.name, label: r.label })),
      unreadNames: staffRoster.rows.filter((p) => !readIds.has(p.id)).map((p) => p.name),
      images: n.images,
    };
  });

  return (
    <main style={{ minHeight: "100dvh" }}>
      <PhoneRedirect to="/notice" />
      <PageHeader backHref="/home" backLabel="대시보드" backLinkStyle={{ cursor: "pointer" }} title="공지사항" maxWidth
        right={<div style={{ fontSize: 12.5, color: "var(--sub)" }}>직원 {staffRoster.rows.length}명 · 학생 {totalStudents}명 · 공지 {rows.length}건</div>}
      />
      <div className="mx-auto max-w-[1080px] px-5 py-5">
        <NoticeList notices={rows} canManage={canManage} canSms={canSms} />
      </div>
    </main>
  );
}
