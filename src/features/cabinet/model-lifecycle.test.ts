import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { modelFixtureBuffer } from '../../../scripts/generate-model-fixtures';
import { parseGlbModel } from './glb-model';
import { createPlacedModel, defaultModelPlacement } from './model-placement';
import { disposeResources } from './model-resources';

test('真实 GLB 加载细长、扁平与偏心模型后正确入柜', async () => {
  for (const kind of ['slender', 'flat'] as const) {
    const result = await parseGlbModel(await modelFixtureBuffer(kind), new AbortController().signal);
    assert.equal(result.stats.triangles, 12);
    const placed = createPlacedModel(result.object, [3, 2, 1], defaultModelPlacement());
    const bounds = new Box3().setFromObject(placed.object, true);
    assert.ok(Math.abs(bounds.min.y) < 1e-7);
    assert.ok(Math.abs(bounds.max.x + bounds.min.x) < 1e-7);
    assert.ok(bounds.max.x - bounds.min.x <= 2.7);
    assert.ok(bounds.max.y - bounds.min.y <= 1.8);
    assert.ok(bounds.max.z - bounds.min.z <= 0.9);
    disposeResources(placed.object);
  }
});
test('空 GLB 与超过面数预算的实际 GLB 被明确拒绝', async () => {
  await assert.rejects(parseGlbModel(await modelFixtureBuffer('empty'), new AbortController().signal), /没有可显示/);
  await assert.rejects(parseGlbModel(await modelFixtureBuffer('triangle-budget'), new AbortController().signal), /面数/);
});
test('旧解析迟到时释放资源，不能返回给已切换或卸载的查看器', async () => {
  const buffer = await modelFixtureBuffer('slender');
  for (const reason of ['model-replaced', 'viewer-unmounted']) {
    const abort = new AbortController();
    const delayed = Promise.withResolvers<Group>();
    const geometry = new BoxGeometry(1, 1, 1); const material = new MeshStandardMaterial(); const object = new Group(); object.add(new Mesh(geometry, material));
    let disposed = 0; geometry.addEventListener('dispose', () => disposed++); material.addEventListener('dispose', () => disposed++);
    const pending = parseGlbModel(buffer, abort.signal, () => delayed.promise);
    abort.abort(new DOMException(reason, 'AbortError'));
    delayed.resolve(object);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(disposed, 2);
  }
});
test('旧解析取消不影响新模型的结果或资源', async () => {
  const oldAbort = new AbortController(); const delayed = Promise.withResolvers<Group>();
  const old = parseGlbModel(await modelFixtureBuffer('slender'), oldAbort.signal, () => delayed.promise);
  oldAbort.abort();
  const current = await parseGlbModel(await modelFixtureBuffer('flat'), new AbortController().signal);
  delayed.resolve(new Group());
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(current.stats.triangles, 12); assert.equal(current.object.children.length, 1);
  disposeResources(current.object);
});
