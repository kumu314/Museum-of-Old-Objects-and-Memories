import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./src/features/cabinet/demo/', import.meta.url)),
  // Small QA GLBs must retain same-origin URLs, matching the runtime loader contract.
  build: { outDir: `${project}dist/scene`, emptyOutDir: true, assetsInlineLimit: 0, rolldownOptions: { input: {
    cabinet: `${project}src/features/cabinet/demo/index.html`,
    modelPreview: `${project}src/features/cabinet/demo/model-preview.html`,
    modelLab: `${project}src/features/cabinet/demo/model-lab.html`,
    qa: `${project}src/features/cabinet/demo/qa.html`,
  } } },
  server: { host: '127.0.0.1', port: 17681, strictPort: true, fs: { allow: [project] } },
});
