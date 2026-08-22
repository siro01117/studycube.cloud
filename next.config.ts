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

  // 공개 폼(/f/**) 응답은 브라우저·중간 프록시(co.kr 소개 사이트의 리라이트 등)에
  // 캐시되면 안 된다 — 과거 리라이트 설정이 깨졌을 때 캐시된 HTML 이 죽은 스크립트
  // 참조를 계속 물고 있어 하이드레이션 영구 실패로 이어진 사고가 있었다.
  // 라우트 파일마다 개별로 응답 헤더를 세팅하는 대신 여기 한 곳에서 경로 패턴으로 건다
  // (허브/폼 화면이 여러 파일로 나뉘어 있어 개별 라우트 설정은 누락되기 쉽다).
  // /_next/static/* 은 해시 파일명이라 캐시되어야 정상 — 이 패턴에 걸리지 않으므로 그대로 둔다.
  async headers() {
    return [
      {
        source: "/f/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
