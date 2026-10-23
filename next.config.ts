import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ['three'],
  webpack(config) {
    config.module.rules.push({ test: /\.glb$/i, type: 'asset/resource' });
    return config;
  },
};
export default config;
