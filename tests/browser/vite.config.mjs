import { fileURLToPath } from 'node:url';
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const config = {
  root: path('./fixture/'),
  publicDir: path('../../public/'),
  cacheDir: path('../../node_modules/.vite/browser-tests'),
  resolve: { alias: [
    { find: 'next/link', replacement: path('./fixture/next-link.tsx') },
    { find: 'next/navigation', replacement: path('./fixture/next-navigation.ts') },
    { find: 'next/image', replacement: path('./fixture/next-image.tsx') },
    { find: /^\.\/cabinet-preview$/, replacement: path('./fixture/cabinet-preview.tsx') },
  ] },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [path('../../')] } },
};
export default config;
