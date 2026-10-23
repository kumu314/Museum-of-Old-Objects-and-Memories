// Actual GLTFLoader parsing and embedded texture decoding in Node, without starting WebGL.
// node verify-models.mjs /path/to/node_modules/three /path/to/node_modules/@napi-rs/canvas/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const T = await import(pathToFileURL(resolve(process.argv[2], 'build/three.module.js')));
const { GLTFLoader } = await import(pathToFileURL(resolve(process.argv[2], 'examples/jsm/loaders/GLTFLoader.js')));
const { loadImage } = await import(pathToFileURL(resolve(process.argv[3])));
globalThis.self = globalThis;
globalThis.createImageBitmap = async blob => loadImage(Buffer.from(await blob.arrayBuffer()));

for (const name of ['cassette', 'ticket']) {
  const bytes = await readFile(new URL(`../${name}.glb`, import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  const binSize = bytes.readUInt32LE(20 + length);
  assert.equal(28 + length + binSize, bytes.length);
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].uri, undefined, 'No external geometry request');
  for (const view of json.bufferViews) {
    assert.equal((view.byteOffset ?? 0) % 4, 0);
    assert.ok((view.byteOffset ?? 0) + view.byteLength <= binSize);
  }
  for (const image of json.images) {
    assert.equal(image.uri, undefined, 'No external texture request');
    assert.ok(Number.isInteger(image.bufferView));
  }
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const bounds = new T.Box3().setFromObject(gltf.scene, true);
  assert.ok(Math.abs(bounds.min.y) < 1e-7, 'Bottom at origin');
  assert.ok(Math.abs(bounds.min.x + bounds.max.x) < 1e-7, 'Centred X');
  assert.ok(Math.abs(bounds.min.z + bounds.max.z) < 1e-7, 'Centred Z');
  const dimensions = bounds.getSize(new T.Vector3());
  assert.ok(dimensions.x > .09 && dimensions.x < .12, 'Metre units');
  assert.ok(dimensions.z > .001, 'Real depth');
  let triangles = 0, meshes = 0;
  const textures = new Set();
  gltf.scene.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    meshes++;
    const p = node.geometry.getAttribute('position'), n = node.geometry.getAttribute('normal');
    for (const value of p.array) assert.ok(Number.isFinite(value));
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < .001);
    const indices = node.geometry.index;
    if (indices !== null) for (const index of indices.array) assert.ok(index >= 0 && index < p.count);
    triangles += (indices?.count ?? p.count) / 3;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material.map !== null) {
        assert.equal(material.map.colorSpace, T.SRGBColorSpace);
        assert.ok(material.map.image.width >= 2048);
      }
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  assert.ok(meshes >= 3);
  assert.ok(triangles > 1000);
  for (const texture of textures) assert.ok(texture.image.width > 0 && texture.image.height > 0, 'Decoded image');
  console.log(`${name}: ${meshes} meshes, ${triangles} triangles, ${textures.size} decoded textures, bottom-centre bounds and GLB container valid`);
}
