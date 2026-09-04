import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite(로컬 개발 DB)는 번들링하지 말고 서버에서 그대로 로드
  serverExternalPackages: ["@electric-sql/pglite"],

  // 클라이언트 라우터 캐시 — dynamic 을 0(캐시 안 함)으로 되돌렸다. 예전엔 30초를 들고 있었는데,
  // "내가 한 조작은 서버액션이 revalidate 하니 괜찮다"는 근거가 반쪽이었다: 남이 자기 기기에서
  // 바꾼 것은 이쪽 revalidate 를 타지 않아서, 화면을 옮겼다 돌아오면 최대 30초 동안 옛 상태가
  // 그대로 보였다. 여러 근무자가 동시에 쓰는 실제 운영에서 이게 계속 문제가 됐다.
  // 화면에 머물러 있는 동안의 갱신은 _shared/LiveRefresh.tsx 가 맡는다.
  experimental: {
    staleTimes: { dynamic: 0, static: 180 },
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
