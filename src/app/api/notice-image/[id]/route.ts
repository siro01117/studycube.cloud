// 공지 사진 한 장을 내려주는 라우트. 목록 쿼리는 사진 id만 내려주고(N+1도, 대용량 페이로드도 피함),
// 실제 바이트는 <img src="/api/notice-image/{id}"> 로 이 라우트가 따로 서빙한다.
//
// 권한 판단(집주인 지시: 판단과 근거를 보고) — 세션 검사를 두지 않는다:
//  - 학생 공지 사진은 공개 폼(로그인 세션이 아니라 이름+코드로 신원확인)에서 보여야 하고, <img> 태그는
//    커스텀 헤더나 폼 필드를 실어 보낼 수 없어 "이름+코드"를 URL에 실을 수밖에 없는데, 그건 URL에
//    개인정보를 넣지 말라는 규칙과 정면으로 부딪힌다.
//  - 대신 id 자체가 UUID(128bit, 사실상 추측 불가)라 서명된 URL과 같은 신뢰 모델이다 — 그 id를 아는
//    사람은 이미 공지 목록(권한 검사를 통과한 화면)을 통해 얻었을 사람이다.
//  - 직원 공지 사진도 같은 이유로 같은 방식을 쓴다(정책을 audience별로 가르면 화면마다 다른 실패
//    모드가 생긴다). 내용 자체도 학원 공지 사진이라 민감도가 낮다 — 계정 정보·성적 같은 게 아니다.
//  - 캐시 헤더(immutable)를 붙이려면 어차피 재검증마다 세션을 다시 확인하지 않는 쪽이 자연스럽다.
import { NextResponse } from "next/server";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ready();
  const { id } = await ctx.params;

  const r = await db.query<{ data: Uint8Array | string; content_type: string }>(
    `select data, content_type from notice_image where id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return new NextResponse(null, { status: 404 });

  // postgres.js/PGlite 드라이버 모두 bytea 를 Uint8Array 계열로 돌려준다 — Buffer 로 통일한 뒤
  // Response body 타입(BodyInit)에 맞게 순수 ArrayBuffer 로 복사한다(Buffer는 Node 확장이라 제외됨).
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as Uint8Array);
  const bytes = new Uint8Array(buf).buffer;

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": row.content_type,
      // 내용이 바뀌지 않는 자원(수정 없이 삭제·재업로드만 가능) — 길게 캐시.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
