import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite(로컬 개발 DB)는 번들링하지 말고 서버에서 그대로 로드
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
