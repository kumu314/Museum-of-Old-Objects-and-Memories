import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 私有素材与可撤销分享内容不允许被缓存：缓存策略在分享接口落地时按开发书 9.5 落实。
};

export default nextConfig;
