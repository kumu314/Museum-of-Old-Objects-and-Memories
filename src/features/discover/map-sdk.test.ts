import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSdk } from './map-sdk';

test('地图脚本超时后清理并允许重试，加载失败不会永久缓存', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const scripts: { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; removed: boolean; remove(): void }[] = [];
  const windowMock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; TMap?: object } = {
    setTimeout,
    clearTimeout,
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() {
      const script = { src: '', async: false, onload: null, onerror: null, removed: false, remove() { this.removed = true; } };
      scripts.push(script);
      return script;
    },
    head: { appendChild() {} },
  } });
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  const loading = loadSdk('timeout-key');
  assert.equal(loadSdk('timeout-key'), loading);
  const timedOut = assert.rejects(loading, /加载超时/);
  context.mock.timers.tick(15_000);
  await timedOut;
  assert.equal(scripts[0]?.removed, true);
  assert.equal(scripts[0]?.onload, null);

  const retry = loadSdk('timeout-key');
  assert.equal(scripts.length, 2);
  const failed = assert.rejects(retry, /加载失败/);
  scripts[1]?.onerror?.();
  await failed;
  assert.equal(scripts[1]?.removed, true);

  const success = loadSdk('timeout-key');
  const sdk = {};
  windowMock.TMap = sdk;
  scripts[2]?.onload?.();
  assert.equal(await success, sdk);
  context.mock.timers.tick(15_000);
  assert.equal(scripts[2]?.removed, false);
});
