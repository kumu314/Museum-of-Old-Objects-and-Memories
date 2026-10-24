import assert from 'node:assert/strict';
import test from 'node:test';
import { clearWebglProbe, probeWebgl2, webglFailure } from './webgl-capability.ts';

const globals = globalThis as Record<string, unknown>;
const originalDocument = globals.document;

type Shapes = { lost?: boolean; noAttributes?: boolean; lose?: () => void };

function context(shapes: Shapes = {}) {
  return {
    isContextLost: () => shapes.lost ?? false,
    getContextAttributes: () => (shapes.noAttributes === true ? null : { alpha: true }),
    getExtension: () => ({ loseContext: shapes.lose ?? (() => {}) }),
  };
}

/** 装一个假的 document，返回还原函数与建过的 canvas 数量。 */
function stubDocument(getContext: (id: string) => unknown) {
  let created = 0;
  globals.document = {
    createElement() { created += 1; return { getContext: (id: string) => getContext(id) }; },
  };
  return () => { globals.document = originalDocument; return created; };
}

// 真实预览机的形态：句柄存在、attributes 为 null。这是必须被拦下的那一种。
test('attributes 为 null 判定为 no-attributes', () => {
  assert.equal(webglFailure(context({ noAttributes: true })), 'no-attributes');
});

test('已丢失的上下文优先判定为 context-lost', () => {
  assert.equal(webglFailure(context({ lost: true, noAttributes: true })), 'context-lost');
});

test('健康上下文返回 null', () => {
  assert.equal(webglFailure(context()), null);
  assert.equal(webglFailure(context({ lose: () => {} })), null);
});

test('没有 document 时给出 no-context 而不是抛错', () => {
  clearWebglProbe();
  globals.document = undefined;
  try { assert.deepEqual(probeWebgl2(), { supported: false, reason: 'no-context' }); }
  finally { globals.document = originalDocument; }
});

test('getContext 返回 null 判定为 no-context', () => {
  clearWebglProbe();
  const restore = stubDocument(() => null);
  try { assert.deepEqual(probeWebgl2(), { supported: false, reason: 'no-context' }); }
  finally { restore(); }
});

test('getContext 抛异常判定为 threw', () => {
  clearWebglProbe();
  const restore = stubDocument(() => { throw new Error('gpu process crashed'); });
  try { assert.deepEqual(probeWebgl2(), { supported: false, reason: 'threw' }); }
  finally { restore(); }
});

test('attributes 缺失时探测失败并归还原配额', () => {
  clearWebglProbe();
  let released = 0;
  const restore = stubDocument(() => context({ noAttributes: true, lose: () => { released += 1; } }));
  try {
    assert.deepEqual(probeWebgl2(), { supported: false, reason: 'no-attributes' });
    assert.equal(released, 1, '探测失败也必须 loseContext，否则每次挂载都白占一个上下文');
  } finally { restore(); }
});

test('健康上下文探测通过，并主动归还临时上下文', () => {
  clearWebglProbe();
  let released = 0;
  const restore = stubDocument(() => context({ lose: () => { released += 1; } }));
  try {
    assert.deepEqual(probeWebgl2(), { supported: true });
    assert.equal(released, 1);
  } finally { restore(); }
});

test('成功结论被缓存，反复挂载不再新建探针', () => {
  clearWebglProbe();
  let created = 0;
  globals.document = { createElement() { created += 1; return { getContext: () => context() }; } };
  try {
    probeWebgl2(); probeWebgl2(); probeWebgl2();
    assert.equal(created, 1, '浏览器对同时存活的上下文有上限，成功结论不应每次重测');
  } finally { globals.document = originalDocument; }
});

test('失败结论不缓存，环境改善后重试可以恢复', () => {
  clearWebglProbe();
  let broken = true;
  globals.document = {
    createElement() { return { getContext: () => (broken ? context({ noAttributes: true }) : context()) }; },
  };
  try {
    assert.equal(probeWebgl2().supported, false);
    broken = false;
    assert.deepEqual(probeWebgl2(), { supported: true }, '无 GPU 的失败不应永久锁死重试');
  } finally { globals.document = originalDocument; }
});
