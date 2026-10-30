import type { NextConfig } from 'next';

const httpsOrigin = process.env.APP_ORIGIN?.startsWith('https://') ?? false;
const development = process.env.NODE_ENV !== 'production';

// Next 的 App Router 会注入内联启动脚本；腾讯地图 SDK 需要从 map.qq.com 及其 CDN 加载。
// 首版不做 nonce 化，因此 script-src 保留 'unsafe-inline'，边界由其余指令守住。
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''} https://*.qq.com`,
  "style-src 'self' 'unsafe-inline' https://*.qq.com",
  "img-src 'self' data: blob: https://*.qq.com https://*.gtimg.com",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' https://*.qq.com https://*.gtimg.com${development ? ' ws://127.0.0.1:* http://127.0.0.1:*' : ''}`,
  "worker-src 'self' blob: https://*.qq.com",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(httpsOrigin ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // HSTS 只对 HTTPS 入口有意义；演示环境的 HTTP 入口不下发，避免错误地锁定域名。
  ...(httpsOrigin ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ['three'],
  logging: { incomingRequests: { ignore: [/^\/(?:api\/)?share\//, /^\/login(?:[/?]|$)/] } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/login', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/share/:path*', headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ] },
    ];
  },
  webpack(config) {
    config.module.rules.push({ test: /\.glb$/i, type: 'asset/resource' });
    return config;
  },
};
export default config;
