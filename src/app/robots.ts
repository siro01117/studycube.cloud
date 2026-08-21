import type { MetadataRoute } from "next";

// 공개 폼(/f/**)은 학생 개인 데이터가 걸린 화면이라 검색 노출 차단.
// (각 폼 페이지도 metadata.robots 로 개별 noindex — 여긴 크롤러 차단선.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/f/"],
    },
  };
}
