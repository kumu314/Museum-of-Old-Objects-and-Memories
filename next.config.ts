import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ['three'],
  logging: { incomingRequests: { ignore: [/^\/(?:api\/)?share\//, /^\/login(?:[/?]|$)/] } },
  async headers() {
    return [{ source: '/login', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }, { source: '/share/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ] }];
  },
  webpack(config) {
    config.module.rules.push({ test: /\.glb$/i, type: 'asset/resource' });
    return config;
  },
};
export default config;
