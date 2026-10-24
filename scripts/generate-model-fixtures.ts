import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoxGeometry } from 'three';
import sharp from 'sharp';
import { modelBudget } from '../src/features/cabinet/glb-model';

export const fixtureNames = ['slender', 'flat', 'textured', 'empty', 'triangle-budget', 'texture-budget'] as const;
export type ModelFixture = typeof fixtureNames[number];

function pack(document: unknown, binary: Buffer): ArrayBuffer {
  const json = Buffer.from(JSON.stringify(document));
  const jsonSize = Math.ceil(json.length / 4) * 4; const binSize = Math.ceil(binary.length / 4) * 4;
  const result = Buffer.alloc(20 + jsonSize + (binSize ? 8 + binSize : 0));
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(32, 20, 20 + jsonSize); json.copy(result, 20);
  if (binSize) { result.writeUInt32LE(binSize, 20 + jsonSize); result.writeUInt32LE(0x004e4942, 24 + jsonSize); binary.copy(result, 28 + jsonSize); }
  return Uint8Array.from(result).buffer;
}

export async function modelFixtureBuffer(kind: ModelFixture): Promise<ArrayBuffer> {
  const asset = { version: '2.0', generator: '拾物馆程序化 QA fixture；非图生 3D 结果' };
  if (kind === 'empty') return pack({ asset, scene: 0, scenes: [{ nodes: [] }] }, Buffer.alloc(0));
  const geometry = kind === 'slender' ? new BoxGeometry(0.04, 8, 0.06)
    : kind === 'flat' ? new BoxGeometry(5, 0.02, 3) : new BoxGeometry(1, 1, 1);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox; const index = geometry.index;
  if (!bounds || !index) throw new Error('Fixture geometry is incomplete');
  const pieces: Buffer[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let byteLength = 0;
  function add(bytes: Buffer) {
    const id = views.length; views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(padded); pieces.push(padded); byteLength += padded.length; return id;
  }
  for (const name of ['position', 'normal', 'uv']) {
    const data = geometry.getAttribute(name).array;
    add(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  const indices = new Uint32Array(kind === 'triangle-budget' ? (modelBudget.triangles + 1) * 3 : index.count);
  for (let i = 0; i < indices.length; i++) indices[i] = index.getX(i % index.count);
  add(Buffer.from(indices.buffer));
  const textured = kind === 'textured' || kind === 'texture-budget';
  if (textured) {
    const png = await sharp({ create: { width: kind === 'texture-budget' ? modelBudget.textureDimension + 1 : 16, height: 2, channels: 4, background: '#cf9e61' } }).png().toBuffer();
    add(png);
  }
  const document = {
    asset, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: kind === 'slender' ? [40, -20, 10] : [-18, 5, 2], scale: kind === 'flat' ? [0.001, 0.001, 0.001] : [1, 1, 1] }],
    buffers: [{ byteLength }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.getAttribute('position').count, type: 'VEC3', min: bounds.min.toArray(), max: bounds.max.toArray() },
      { bufferView: 1, componentType: 5126, count: geometry.getAttribute('normal').count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: geometry.getAttribute('uv').count, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.72, 0.43, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.65, ...(textured ? { baseColorTexture: { index: 0 } } : {}) } }],
    ...(textured ? { textures: [{ source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }] } : {}),
  };
  geometry.dispose(); return pack(document, Buffer.concat(pieces));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = new URL('../src/features/cabinet/demo/fixtures/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const kind of fixtureNames) {
    const bytes = await modelFixtureBuffer(kind); await writeFile(new URL(`${kind}.glb`, directory), new Uint8Array(bytes));
    process.stdout.write(`${kind}.glb ${bytes.byteLength} bytes\n`);
  }
}
