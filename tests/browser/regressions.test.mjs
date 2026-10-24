import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import config from './vite.config.mjs';
import { id, original, museum, job, memoirFixture, contributionInbox } from './fixtures.mjs';

let server;
let browser;
let origin;
before(async () => {
  server = await createServer({ ...config, configFile: false, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function withPage(work) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // 浏览器仅访问本次随机端口；API 全部由各用例拦截，不允许落到真实服务。
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  try { await work(page); assert.deepEqual(errors, []); }
  finally { await page.close(); }
}

for (const refreshFails of [false, true]) {
  test(`私密发布后提供展馆入口且不自动开启分享：${refreshFails ? '状态刷新失败仍保留成功入口' : '重新读取后保留入口'}`, { timeout: 30_000 }, async () => {
    await withPage(async (page) => {
      let published = false;
      let shareWrites = 0;
      const ready = { ...museum, exhibits: [{ ...original, confirmedVersion: 1, confirmedAt: original.updatedAt, confirmationNote: '已核对合成资料' }] };
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/share')) { shareWrites++; return route.abort(); }
        if (url.pathname.endsWith('/publish')) {
          published = true;
          return route.fulfill({ json: { data: { museumId: museum.id, snapshotId: id(80), version: 2, token: null } } });
        }
        if (url.pathname === `/api/museums/${museum.id}`) {
          if (published && refreshFails) return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: '合成刷新失败', requestId: id(99) } } });
          return route.fulfill({ json: { data: { ...ready, publishedVersion: published ? 2 : null } } });
        }
        if (url.pathname.endsWith('/latest')) return route.fulfill({ json: { data: null } });
        return route.abort();
      });
      await page.goto(origin);
      await page.getByRole('button', { name: '发布展馆', exact: true }).click();
      assert.equal(await page.getByRole('link', { name: '进入展馆 →', exact: true }).count(), 0);
      await page.getByRole('button', { name: '发布整座展馆', exact: true }).click();
      const entry = page.getByRole('link', { name: '进入展馆 →', exact: true });
      await entry.waitFor();
      await page.waitForFunction(() => document.querySelector('a[href="/museum/published"]')?.getAttribute('aria-disabled') === 'false');
      assert.equal(await entry.getAttribute('href'), '/museum/published');
      assert.equal(shareWrites, 0);
      await page.getByText('目前仅自己可见，邀请他人参观需另行开启持链接访问。', { exact: false }).first().waitFor();
      if (refreshFails) await page.getByText('操作已完成，但展馆状态尚未刷新。', { exact: false }).first().waitFor();
    });
  });
}

for (const dirtyDuringRecovery of [false, true]) {
  test(`真实工作台恢复已完成模型：${dirtyDuringRecovery ? '保留等待期间输入' : '只读取一次恢复快照且不重复采纳'}`, { timeout: 30_000 }, async () => {
    await withPage(async (page) => {
      let reads = 0;
      let adopts = 0;
      let recoveryRequest;
      const recoveryStarted = deferred();
      const releaseRecovery = deferred();
      const recovered = { ...original, version: 2, generatedModelAssetId: id(5) };
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/latest')) return route.fulfill({ json: { data: job } });
        if (url.pathname.endsWith('/adopt')) { adopts++; return route.abort(); }
        if (url.pathname === `/api/museums/${id(2)}`) {
          reads++;
          if (reads === 1) return route.fulfill({ json: { data: museum } });
          recoveryRequest = route.request();
          recoveryStarted.resolve();
          await releaseRecovery.promise;
          return route.fulfill({ json: { data: { ...museum, version: 3, exhibits: [recovered] } } });
        }
        return route.abort();
      });
      await page.goto(origin);
      await recoveryStarted.promise;
      if (dirtyDuringRecovery) await page.locator('input[id$="-name-input"]').fill('恢复期间尚未保存的名称');
      releaseRecovery.resolve();
      // 编辑会取消正在恢复的请求；取消与正常响应都属于完成，不能只等待 response 事件。
      await recoveryRequest.response();
      if (dirtyDuringRecovery) {
        assert.equal(await page.locator('input[id$="-name-input"]').inputValue(), '恢复期间尚未保存的名称');
        assert.equal(await page.getByTestId(`model-${id(1)}`).textContent(), 'photo-plane');
      } else {
        await page.getByTestId(`model-${id(1)}`).getByText(id(5), { exact: true }).waitFor();
        await page.getByRole('button', { name: '展示设置', exact: true }).click();
        await page.getByText('模型已入柜（已通过模型校验）', { exact: false }).waitFor();
      }
      // 等待该请求触发的 React effect；旧实现在此会发出第三次 GET。
      await page.waitForTimeout(150);
      assert.equal(reads, 2);
      assert.equal(adopts, 0);
    });
  });
}

for (const failure of [false, true]) {
  test(`贡献提交 pending 锁定编辑：${failure ? '失败保留输入并解锁' : '成功后可编辑下一份'}`, { timeout: 30_000 }, async () => {
    await withPage(async (page) => {
      const received = deferred();
      const release = deferred();
      await page.route('**/api/**', async (route) => {
        if (route.request().method() === 'POST') {
          received.resolve(); await release.promise;
          if (failure) return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: '合成失败', requestId: id(99) } } });
          return route.fulfill({ json: { data: { id: id(40), exhibitId: id(11), authorId: id(30), authorName: '合成用户', authorRole: 'coauthor', story: 'A已提交', sourceNote: '合成来源', publishConsent: false, withdrawnAt: null, createdAt: original.createdAt, isDemo: false } } });
        }
        return route.fulfill({ json: { data: contributionInbox } });
      });
      await page.goto(`${origin}/?view=contributions`);
      await page.getByRole('button', { name: '写一份讲述' }).first().click();
      await page.getByLabel('你记得的事').fill('A已提交');
      await page.getByLabel('来源（谁讲的、何时何地）').fill('合成来源');
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('button', { name: '写一份讲述' }).click();
      assert.equal(await page.getByLabel('你记得的事').inputValue(), 'A已提交');
      await page.getByRole('button', { name: '提交', exact: true }).click();
      await received.promise;
      for (const locator of [page.getByRole('button', { name: '写一份讲述' }), page.getByRole('button', { name: '取消', exact: true }), page.getByLabel('你记得的事'), page.getByLabel('来源（谁讲的、何时何地）'), page.getByRole('checkbox')]) assert.equal(await locator.isDisabled(), true);
      release.resolve();
      if (failure) {
        await page.getByText('合成失败', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('你记得的事').inputValue(), 'A已提交');
        assert.equal(await page.getByLabel('你记得的事').isDisabled(), false);
      } else {
        await page.getByText('已记录你的讲述，署名是你本人；它不会和别人的内容合并。', { exact: true }).waitFor();
        await page.getByRole('button', { name: '写一份讲述' }).nth(1).click();
        await page.getByLabel('你记得的事').fill('B的新草稿');
        assert.equal(await page.getByLabel('你记得的事').inputValue(), 'B的新草稿');
      }
    });
  });
}

for (const scenario of ['complete', 'skip', 'refuse', 'refresh', 'mutate-refresh', 'save-clean']) {
  test(`自传输入保护：${scenario}`, { timeout: 30_000 }, async () => {
    await withPage(async (page) => {
      const book = memoirFixture();
      let writes = 0;
      await page.route('**/api/**', (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        if (url.pathname === '/api/museums') return route.fulfill({ json: { data: [] } });
        if (url.pathname === '/api/memoirs') return route.fulfill({ json: { data: { items: [{ memoir: book.memoir, sourceVersion: 1 }], nextCursor: null } } });
        if (url.pathname.endsWith('/export')) return route.fulfill({ json: book });
        writes++;
        if (method === 'PUT') {
          const body = route.request().postDataJSON();
          book.chapters[0].version++;
          book.chapters[0].currentRevisionId = id(20);
          book.revisions.push({ ...book.revisions[0], id: id(20), version: 2, title: body.title, paragraphs: body.paragraphs });
        } else if (method === 'PATCH') {
          book.sessions[0] = { ...book.sessions[0], state: 'completed', currentQuestionId: null, topic: { ...book.sessions[0].topic, disposition: 'completed' } };
        }
        return route.fulfill({ json: { data: {} } });
      });
      await page.goto(`${origin}/?view=memoir`);
      await page.getByRole('button', { name: '合成自传', exact: true }).click();
      const answer = page.locator('textarea').first();
      await answer.waitFor();
      if (['complete', 'skip', 'refuse'].includes(scenario)) {
        await answer.fill('尚未保存回答');
        await page.getByRole('checkbox').first().check();
        assert.equal(await page.getByRole('button', { name: '生成一个追问', exact: true }).isDisabled(), true);
        const button = page.getByRole('button', { name: { complete: '结束话题', skip: '跳过', refuse: '不愿回答' }[scenario], exact: true });
        page.once('dialog', (dialog) => dialog.dismiss());
        await button.click();
        assert.equal(writes, 0);
        assert.equal(await answer.inputValue(), '尚未保存回答');
        page.once('dialog', (dialog) => dialog.accept());
        await button.click();
        await page.getByText('话题已结束。', { exact: true }).waitFor();
        assert.equal(writes, 1);
        return;
      }
      await page.getByRole('button', { name: '测试章节', exact: true }).click();
      const paragraph = page.locator('label').filter({ hasText: '段落 1' }).locator('textarea');
      await paragraph.fill('本地未保存段落');
      if (scenario === 'save-clean') {
        await page.getByRole('button', { name: '保存章节', exact: true }).click();
        await page.getByText('章节已保存，请重新核对来源并确认。', { exact: true }).waitFor();
        let dialogs = 0;
        page.on('dialog', (dialog) => { dialogs++; return dialog.dismiss(); });
        await page.getByRole('button', { name: '合成自传', exact: true }).click();
        await page.getByText('已读取服务端存档。', { exact: true }).waitFor();
        assert.equal(dialogs, 0);
        return;
      }
      book.chapters[0].version = 2;
      book.chapters[0].currentRevisionId = id(21);
      book.revisions.push({ ...book.revisions[0], id: id(21), version: 2, paragraphs: [{ ...book.revisions[0].paragraphs[0], text: '远端新段落' }] });
      if (scenario === 'refresh') await page.getByRole('button', { name: '重新读取状态', exact: true }).click();
      else {
        await page.locator('label').filter({ hasText: '补充原始资料' }).locator('textarea').fill('补充测试');
        await page.getByRole('button', { name: '保存补充资料', exact: true }).click();
      }
      await page.getByText('服务端章节已有新修订', { exact: false }).waitFor();
      assert.equal(await paragraph.inputValue(), '本地未保存段落');
      assert.equal(await page.getByRole('button', { name: '保存章节', exact: true }).isDisabled(), true);
      const discard = page.getByRole('button', { name: '放弃本地编辑并载入服务端版本' });
      page.once('dialog', (dialog) => dialog.dismiss());
      await discard.click();
      assert.equal(await paragraph.inputValue(), '本地未保存段落');
      page.once('dialog', (dialog) => dialog.accept());
      await discard.click();
      assert.equal(await paragraph.inputValue(), '远端新段落');
    });
  });
}
