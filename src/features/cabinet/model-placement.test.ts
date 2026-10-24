import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { createPlacedModel, defaultModelPlacement, modelPlacementSchema } from './model-placement';
import { disposeResources } from './model-resources';

test('不同输入单位、偏移和陈列方向均落地居中且不超过柜格预算', () => {
  for (const units of [0.001, 1, 1000]) {
    const asset = new Group();
    const mesh = new Mesh(new BoxGeometry(2, 1, 0.5), new MeshStandardMaterial());
    mesh.position.set(10, -5, 7); asset.add(mesh); asset.scale.setScalar(units);
    const placed = createPlacedModel(asset, [3, 2, 1], { rotation: [35, -80, 15], size: 1 });
    const bounds = new Box3().setFromObject(placed.object, true);
    assert.ok(Math.abs(bounds.min.y) < 1e-8);
    assert.ok(Math.abs(bounds.min.x + bounds.max.x) < 1e-8);
    assert.ok(Math.abs(bounds.min.z + bounds.max.z) < 1e-8);
    assert.ok(bounds.max.x - bounds.min.x <= 2.7 + 1e-8);
    assert.ok(bounds.max.y - bounds.min.y <= 1.8 + 1e-8);
    assert.ok(bounds.max.z - bounds.min.z <= 0.9 + 1e-8);
    assert.equal(asset.scale.x, units);
    disposeResources(placed.object);
  }
});

test('检视中的父节点变换不改变陈列基准；大小调整不重建几何', () => {
  const asset = new Mesh(new BoxGeometry(1, 2, 0.5), new MeshStandardMaterial());
  const placed = createPlacedModel(asset, [3, 3, 3], defaultModelPlacement());
  const initialPosition = placed.object.position.clone();
  const initialScale = placed.object.scale.x;
  const parent = new Group(); parent.add(placed.object);
  parent.position.set(99, 30, -6); parent.rotation.set(0.4, 0.8, -0.1); parent.scale.setScalar(1.45); parent.updateMatrixWorld(true);
  placed.setPlacement(defaultModelPlacement());
  assert.equal(placed.object.parent, parent);
  assert.deepEqual(placed.object.position, initialPosition);
  assert.equal(placed.object.scale.x, initialScale);
  placed.setPlacement({ rotation: [0, 0, 0], size: 0.5 });
  assert.ok(Math.abs(placed.object.scale.x / initialScale - 2 / 3) < 1e-8);
  assert.equal(asset.geometry.getAttribute('position').count, 24);
  disposeResources(placed.object);
});

test('陈列参数拒绝非有限值、越界大小与不完整旋转', () => {
  for (const value of [
    { rotation: [0, NaN, 0], size: 0.75 }, { rotation: [0, 181, 0], size: 0.75 },
    { rotation: [0, 0], size: 0.75 }, { rotation: [0, 0, 0], size: 0 },
    { rotation: [0, 0, 0], size: 1.01 }, { rotation: [0, 0, 0], size: Infinity },
  ]) assert.equal(modelPlacementSchema.safeParse(value).success, false);
});

test('共享几何、材质和纹理按一次生命周期释放', () => {
  const root = new Group(); const geometry = new BoxGeometry(1, 1, 1); const texture = new Texture(); const material = new MeshStandardMaterial({ map: texture });
  root.add(new Mesh(geometry, material), new Mesh(geometry, material));
  let geometries = 0; let materials = 0; let textures = 0;
  geometry.addEventListener('dispose', () => geometries++); material.addEventListener('dispose', () => materials++);
  texture.addEventListener('dispose', () => textures++);
  disposeResources(root);
  assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(textures, 1);
});
