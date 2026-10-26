import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import config from './vite.config.mjs';

let server;
let browser;
let origin;
let glb;
before(async () => {
  server = await createServer({ ...config, configFile: false, logLevel: 'error', cacheDir: `${config.cacheDir}/model-loading`,
    resolve: { alias: config.resolve.alias.filter((entry) => !(entry.find instanceof RegExp)) } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  // 仅在隔离合成页面使用软件 WebGL，使无 GPU 的 CI 与本机采用相同后端。
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
    ...(executablePath ? { executablePath } : {}) });
  glb = await readFile(new URL('../../src/features/cabinet/demo/fixtures/flat.glb', import.meta.url));
});
after(async () => { await browser?.close(); await server?.close(); });

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.workbench-cabinet-viewport')?.getAttribute('data-surface') === 'ready');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === '3D 预览' && !button.disabled));
}

async function withCabinet(work) {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  const requests = [];
  let failedReads = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.includes('/model-assets/')) {
      requests.push(url.pathname.split('/').at(-1));
      return route.fulfill({ status: url.pathname.endsWith('/failed-model') && failedReads++ === 0 ? 404 : 200,
        contentType: 'model/gltf-binary', body: glb, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (url.pathname.endsWith('/assets/photo')) return route.fulfill({ contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64') });
    if (url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  try {
    await page.goto(`${origin}/model-loading.html`);
    await ready(page);
    assert.deepEqual(requests.slice().sort(), ['first-model', 'second-model']);
    await work(page, requests);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

test('真实展柜资料刷新和同页换格不重新下载，检视状态保持', { timeout: 120_000 }, async () => {
  await withCabinet(async (page, requests) => {
    await page.getByRole('button', { name: '刷新资料', exact: true }).click();
    await page.getByText('合成模型一更新', { exact: true }).first().waitFor();
    await page.waitForTimeout(250);
    assert.equal(requests.length, 2, '资料更新必须复用已解析的模型与 WebGL 场景');
    await page.getByRole('button', { name: '交换格位', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(requests.length, 2, '格位调整不重新下载');
    await page.getByRole('button', { name: '3D 预览', exact: true }).click();
    await page.getByRole('button', { name: '刷新资料', exact: true }).click();
    await page.getByRole('dialog', { name: '检视合成模型二更新更新', exact: true }).waitFor();
    await page.getByRole('button', { name: '旋转模型', exact: true }).click();
    await page.getByRole('button', { name: '放大模型', exact: true }).click();
    assert.equal(requests.length, 2, '资料刷新保留检视状态和已加载模型');
    await page.getByRole('button', { name: '返回展柜', exact: false }).click();
  });
});

test('真实展柜模型替换、失败回退与重试仍可恢复', { timeout: 120_000 }, async () => {
  await withCabinet(async (page, requests) => {
    await page.getByRole('button', { name: '替换模型', exact: true }).click();
    await ready(page);
    assert.ok(requests.includes('new-model'));
    await page.getByRole('button', { name: '失效模型', exact: true }).click();
    await page.getByText('生成模型加载失败', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: '重试模型', exact: true }).click();
    await ready(page);
    assert.equal(requests.filter((id) => id === 'failed-model').length, 2);
  });
});

test('真实展柜翻页按当前页重新加载模型', { timeout: 120_000 }, async () => {
  await withCabinet(async (page, requests) => {
    await page.getByRole('button', { name: '移至下一页', exact: true }).click();
    await page.getByRole('button', { name: '下一页 →', exact: true }).click();
    await ready(page);
    assert.equal(requests.filter((id) => id === 'first-model').length, 2);
    assert.equal(requests.filter((id) => id === 'second-model').length, 2);
  });
});
