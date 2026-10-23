import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./src/features/cabinet/demo/', import.meta.url)),
  build: { outDir: `${project}dist/scene`, emptyOutDir: true },
  server: { host: '127.0.0.1', port: 17681, strictPort: true, fs: { allow: [project] } },
});
