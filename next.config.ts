import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 프로덕션 단일 컨테이너 배포를 위한 standalone 출력
  output: "standalone",
};

export default nextConfig;
