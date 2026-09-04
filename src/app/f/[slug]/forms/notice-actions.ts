"use server";

// 학생용 공지(ntc7h2qm) 전용 서버 액션 — 조회 1개 + 읽음 처리 1개 + 허브 배지용 안 읽은 개수 1개.
// 쓰기(작성/수정/삭제)는 여기 없다 — 관리자만 올릴 수 있어야 하므로 m/notice/actions.ts 하나로 통일.
// 본인확인은 다른 공개 폼과 같은 원칙: 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시 찾는다
// (student-info-actions.ts verifyIdentity 와 동일 패턴 — 파일마다 로컬로 두는 기존 관례를 따름).
// DEV-ONLY 테스트 신원(허브 "테스트로 건너뛰기")은 실제 student 행이 없어 notice_student_read 에
// 쓸 수 없다 — 조회는 항상 빈 목록 + testBypass:true 로 돌려주고, 읽음 처리는 조용히 no-op 한다.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { dateTimeLabel } from "@/lib/date";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

type IdentityResult =
  | { ok: true; studentId: string; testBypass: false }
  | { ok: true; studentId: null; testBypass: true }
  | { ok: false; error: string; kind?: "identity" };

async function verifyIdentity(formData: FormData): Promise<IdentityResult> {
  const name = s(formData.get("name"));
  const code = s(formData.get("code"));
  if (process.env.NODE_ENV !== "production" && s(formData.get("test")) === "1") {
    return { ok: true, studentId: null, testBypass: true };
  }
  const match = await findStudent(name, code);
  if (!match.ok) return { ok: false, error: publicAuthError(match.reason), kind: "identity" };
  return { ok: true, studentId: match.id, testBypass: false };
}

export type MyNoticeRow = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  authorName: string;
  createdLabel: string;
  isRead: boolean;
  images: { id: string }[]; // id만(바이너리는 /api/notice-image/[id]가 따로 서빙, 캐시 헤더 붙음)
};

export type MyNoticeListResult =
  | { ok: true; testBypass: boolean; notices: MyNoticeRow[] }
  | { ok: false; error: string; kind?: "identity" };

/** FormData 필드: name, code, (개발전용) test="1". 안 읽은 공지·중요 공지가 위로 오도록 정렬해서 준다
 * (직원용 /notice 페이지의 정렬 규칙과 동일 — MobileNotice 화면 관례를 학생 쪽에도 그대로 따름). */
export async function getMyNotices(formData: FormData): Promise<MyNoticeListResult> {
  await ready();
  const identity = await verifyIdentity(formData);
  if (!identity.ok) return identity;
  if (identity.testBypass) return { ok: true, testBypass: true, notices: [] };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  // 사진은 id만(바이너리는 안 실어 보냄) — 상관 서브쿼리로 한 왕복에 같이 담아 N+1을 피한다.
  const { rows } = await db.query<{
    id: string; title: string; body: string; important: boolean; created_at: string;
    author_name: string | null; is_read: boolean; images: { id: string }[];
  }>(
    `select n.id, n.title, n.body, n.important, n.created_at::text as created_at,
            p.name as author_name, (nsr.student_id is not null) as is_read,
            coalesce(
              (select json_agg(json_build_object('id', ni.id) order by ni.position)
                 from notice_image ni where ni.notice_id = n.id),
              '[]'
            ) as images
       from notice n
       left join person p on p.id = n.author_id
       left join notice_student_read nsr on nsr.notice_id = n.id and nsr.student_id = $2
      where n.branch_id = $1 and n.audience = 'student'
      order by is_read asc, n.important desc, n.created_at desc`,
    [branch, identity.studentId],
  );

  const notices: MyNoticeRow[] = rows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    important: n.important,
    authorName: n.author_name ?? "학원",
    createdLabel: dateTimeLabel(n.created_at),
    isRead: n.is_read,
    images: n.images,
  }));
  return { ok: true, testBypass: false, notices };
}

/** FormData 필드: id, name, code, (개발전용) test="1". 원자적 upsert — 같은 학생이 여러 번 열어도 1행. */
export async function markMyNoticeRead(formData: FormData): Promise<{ ok: boolean }> {
  await ready();
  const identity = await verifyIdentity(formData);
  if (!identity.ok || identity.testBypass) return { ok: false };
  const id = s(formData.get("id"));
  if (!id) return { ok: false };
  // audience='student' 인 공지만 학생 기준 읽음으로 기록 — 직원 공지 id 가 잘못 들어와도 섞이지 않는다.
  await db.query(
    `insert into notice_student_read(notice_id, student_id)
     select $1, $2 from notice where id=$1 and audience='student'
     on conflict (notice_id, student_id) do nothing`,
    [id, identity.studentId],
  );
  return { ok: true };
}

/** 허브 카드 배지용 — 안 읽은 학생 공지 개수만 가볍게. checkScheduleWindow(schedule-window-actions.ts)와
 * 같은 자리(허브가 신원 확인 직후 호출)에서 쓰는 용도라 형태를 맞췄다. */
export async function getUnreadMyNoticeCount(formData: FormData): Promise<{ ok: true; count: number } | { ok: false }> {
  await ready();
  const identity = await verifyIdentity(formData);
  if (!identity.ok) return { ok: false };
  if (identity.testBypass) return { ok: true, count: 0 };

  const branch = await branchId();
  if (!branch) return { ok: false };

  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from notice n
      where n.branch_id = $1 and n.audience = 'student'
        and not exists (select 1 from notice_student_read nsr where nsr.notice_id = n.id and nsr.student_id = $2)`,
    [branch, identity.studentId],
  );
  return { ok: true, count: r.rows[0]?.n ?? 0 };
}
