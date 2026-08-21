import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite(로컬 개발 DB)는 번들링하지 말고 서버에서 그대로 로드
  serverExternalPackages: ["@electric-sql/pglite"],

  // 클라이언트 라우터 캐시 — 한 번 방문한 모듈 화면을 잠깐 들고 있다가
  // 재방문 시 즉시 보여주고 뒤에서 갱신한다. dynamic 기본값은 0(캐시 안 함).
  // 30초면 "탭 몇 개 왔다갔다" 하는 동안은 서버 왕복 0, 그 뒤엔 자연히 새로고침.
  // 데이터가 바뀌는 조작(입실·순찰·벌점)은 서버액션이 revalidate 하므로 즉시 반영된다.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
    // 공개 폼(/f/**)이 studycube.co.kr → studycube.cloud 로 리라이트 프록시된다.
    // 서버액션은 기본적으로 Origin 헤더가 요청 호스트와 같아야 통과하는데, 프록시를 거치면
    // Origin 이 studycube.co.kr 로 들어와 기본 검사에 막힌다 — 허용 오리진에 명시.
    serverActions: { allowedOrigins: ["studycube.co.kr", "www.studycube.co.kr"] },
  },
};

export default nextConfig;
