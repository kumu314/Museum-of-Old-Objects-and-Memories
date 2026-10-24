import { Hunyuan3DError } from './errors';
import type { HunyuanGlbStats } from './types';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

// 展示端挂载的是未配置 DRACOLoader/KTX2Loader/MeshoptDecoder 的裸 GLTFLoader，
// 必需扩展按当前加载链的真实能力收敛：只允许原生支持的材质扩展。
const ALLOWED_REQUIRED_EXTENSIONS = new Set(['KHR_materials_unlit']);
// 解码类扩展即使供应商漏写 extensionsUsed/extensionsRequired 也必须拒绝：
// 分别作用于 primitive（Draco）、bufferView（Meshopt）与纹理/图片（Basis/KTX2）。
const REJECTED_DECODER_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu',
]);

const COMPONENT_SIZES: Record<number, number> = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};
const TYPE_LENGTHS: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

function invalid(message: string): never {
  throw new Hunyuan3DError('INVALID_GLB', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return invalid(`GLB 的 ${field} 必须是字符串数组。`);
  }
  return value;
}

function recordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    return invalid(`GLB 的 ${field} 必须是对象数组。`);
  }
  return value;
}

function requirePrimitiveArray(value: unknown, field: string): Record<string, unknown>[] {
  const entries = recordArray(value, field);
  if (entries.length === 0) return invalid(`GLB 的 ${field} 不能为空。`);
  return entries;
}

function integerField(value: Record<string, unknown>, key: string, field: string, minimum = 0): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || (raw as number) < minimum) {
    return invalid(`GLB 的 ${field} 必须是不小于 ${minimum} 的整数。`);
  }
  return raw as number;
}

function objectIndex(value: Record<string, unknown>, key: string, length: number, field: string): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) >= length) {
    return invalid(`GLB 的 ${field} 索引越界。`);
  }
  return raw as number;
}

function extensionNames(value: Record<string, unknown>, where: string): string[] {
  const extensions = value.extensions;
  if (extensions === undefined) return [];
  if (!isRecord(extensions)) return invalid(`GLB 的 ${where}.extensions 结构无效。`);
  return Object.keys(extensions);
}

function rejectDecoderExtensions(names: readonly string[], where: string): void {
  for (const name of names) {
    if (REJECTED_DECODER_EXTENSIONS.has(name)) {
      return invalid(`当前加载链不支持 ${where} 使用的扩展：${name}`);
    }
  }
}

type BinChunk = { readonly start: number; readonly end: number };

function parseContainer(buffer: Buffer): { json: Record<string, unknown>; binChunk: BinChunk } {
  let offset = 12;
  let parsed: Record<string, unknown> | undefined;
  let binChunk: BinChunk | undefined;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) invalid('GLB 分块头不完整。');
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > buffer.byteLength) invalid('GLB 分块长度越界。');
    if (parsed === undefined) {
      if (chunkType !== JSON_CHUNK) invalid('GLB 第一个分块必须是 JSON。');
      try {
        const json: unknown = JSON.parse(buffer.toString('utf8', dataStart, dataEnd).replace(/\u0000+$/g, '').trim());
        if (!isRecord(json)) invalid('GLB 的 JSON 分块必须是对象。');
        parsed = json;
      } catch (error) {
        if (error instanceof Hunyuan3DError) throw error;
        invalid('GLB 的 JSON 分块无法解析。');
      }
    } else if (chunkType === BIN_CHUNK) {
      if (binChunk !== undefined) invalid('GLB 包含多个 BIN 分块。');
      binChunk = { start: dataStart, end: dataEnd };
    } else {
      invalid('GLB 包含未知分块类型。');
    }
    offset = dataEnd;
  }
  if (parsed === undefined) invalid('GLB 缺少 JSON 分块。');
  if (binChunk === undefined) invalid('GLB 缺少 BIN 分块。');
  return { json: parsed, binChunk };
}

function validateBufferAndViews(
  json: Record<string, unknown>,
  binChunk: BinChunk,
  bufferViewCount: { value: number },
): void {
  const buffers = recordArray(json.buffers, 'buffers');
  if (buffers.length !== 1) invalid('GLB 必须恰好包含一个内嵌 buffer。');
  const buffer = buffers[0];
  if (buffer === undefined || buffer.uri !== undefined) invalid('GLB 的 buffer 不能引用外部资源。');
  const bufferByteLength = integerField(buffer, 'byteLength', 'buffers[0].byteLength');
  if (bufferByteLength === undefined) invalid('GLB 的 buffers[0].byteLength 必须是整数。');
  if (binChunk.end - binChunk.start < bufferByteLength) invalid('GLB buffer 长度超过 BIN 分块。');

  const bufferViews = recordArray(json.bufferViews, 'bufferViews');
  bufferViewCount.value = bufferViews.length;
  for (const [index, view] of bufferViews.entries()) {
    const bufferIndex = objectIndex(view, 'buffer', 1, `bufferViews[${index}].buffer`);
    if (bufferIndex === undefined) invalid(`GLB 的 bufferViews[${index}] 缺少 buffer 索引。`);
    const byteLength = integerField(view, 'byteLength', `bufferViews[${index}].byteLength`);
    if (byteLength === undefined) invalid(`GLB 的 bufferViews[${index}].byteLength 必须是整数。`);
    const byteOffset = integerField(view, 'byteOffset', `bufferViews[${index}].byteOffset`) ?? 0;
    if (byteOffset + byteLength > bufferByteLength) invalid(`GLB 的 bufferViews[${index}] 越过 buffer 边界。`);
    const byteStride = view.byteStride;
    if (byteStride !== undefined &&
      (!Number.isInteger(byteStride) || (byteStride as number) < 4 || (byteStride as number) > 252 ||
        (byteStride as number) % 4 !== 0)) {
      invalid(`GLB 的 bufferViews[${index}].byteStride 无效。`);
    }
    rejectDecoderExtensions(extensionNames(view, `bufferViews[${index}]`), `bufferViews[${index}]`);
  }
}

function validateAccessors(json: Record<string, unknown>, bufferViewCount: number): void {
  const accessors = recordArray(json.accessors, 'accessors');
  for (const [index, accessor] of accessors.entries()) {
    const count = integerField(accessor, 'count', `accessors[${index}].count`);
    if (count === undefined || count < 1) invalid(`GLB 的 accessors[${index}].count 必须为正整数。`);
    const componentType = accessor.componentType;
    if (typeof componentType !== 'number' || COMPONENT_SIZES[componentType] === undefined) {
      invalid(`GLB 的 accessors[${index}].componentType 无效。`);
    }
    const type = accessor.type;
    if (typeof type !== 'string' || TYPE_LENGTHS[type] === undefined) {
      invalid(`GLB 的 accessors[${index}].type 无效。`);
    }
    if (accessor.sparse !== undefined) invalid(`GLB 的 accessors[${index}] 不支持稀疏数据。`);
    const viewIndex = objectIndex(accessor, 'bufferView', bufferViewCount, `accessors[${index}].bufferView`);
    if (viewIndex === undefined) invalid(`GLB 的 accessors[${index}] 缺少 bufferView。`);
    const view = recordArray(json.bufferViews, 'bufferViews')[viewIndex];
    if (view === undefined) invalid(`GLB 的 accessors[${index}].bufferView 索引越界。`);
    const elementSize = (COMPONENT_SIZES[componentType as number] ?? 0) * (TYPE_LENGTHS[type as string] ?? 0);
    const byteOffset = integerField(accessor, 'byteOffset', `accessors[${index}].byteOffset`) ?? 0;
    const viewByteLength = integerField(view, 'byteLength', `bufferViews[${viewIndex}].byteLength`) ?? 0;
    const stride = view.byteStride;
    if (typeof stride === 'number') {
      if (stride < elementSize) invalid(`GLB 的 accessors[${index}] 超过 bufferView 步长。`);
      if ((count - 1) * stride + byteOffset + elementSize > viewByteLength) {
        invalid(`GLB 的 accessors[${index}] 越过 bufferView 边界。`);
      }
    } else if (byteOffset + count * elementSize > viewByteLength) {
      invalid(`GLB 的 accessors[${index}] 越过 bufferView 边界。`);
    }
  }
}

function validateMeshes(json: Record<string, unknown>, accessorCount: number, materialCount: number): void {
  for (const [meshIndex, mesh] of recordArray(json.meshes, 'meshes').entries()) {
    const primitives = requirePrimitiveArray(mesh.primitives, `meshes[${meshIndex}].primitives`);
    for (const [primitiveIndex, primitive] of primitives.entries()) {
      const where = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      rejectDecoderExtensions(extensionNames(primitive, where), where);
      const attributes = primitive.attributes;
      if (!isRecord(attributes)) invalid(`GLB 的 ${where}.attributes 必须是对象。`);
      for (const attributeValue of Object.values(attributes)) {
        if (!Number.isInteger(attributeValue) || (attributeValue as number) < 0 || (attributeValue as number) >= accessorCount) {
          invalid(`GLB 的 ${where}.attributes 索引越界。`);
        }
      }
      objectIndex(primitive, 'indices', accessorCount, `${where}.indices`);
      objectIndex(primitive, 'material', materialCount, `${where}.material`);
      const mode = primitive.mode;
      if (mode !== undefined && (!Number.isInteger(mode) || (mode as number) < 0 || (mode as number) > 6)) {
        invalid(`GLB 的 ${where}.mode 无效。`);
      }
    }
  }
}

function validateMaterialsAndTextures(json: Record<string, unknown>): void {
  const materials = recordArray(json.materials, 'materials');
  const textures = recordArray(json.textures, 'textures');
  const images = recordArray(json.images, 'images');
  const samplers = recordArray(json.samplers, 'samplers');

  for (const [materialIndex, material] of materials.entries()) {
    const pbr = material.pbrMetallicRoughness;
    const textureHolders = isRecord(pbr) ? [material, pbr] : [material];
    for (const holder of textureHolders) {
      for (const key of ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture']) {
        const reference = holder[key];
        if (reference === undefined) continue;
        if (!isRecord(reference)) invalid(`GLB 的 materials[${materialIndex}].${key} 必须是对象。`);
        objectIndex(reference, 'index', textures.length, `materials[${materialIndex}].${key}.index`);
      }
    }
  }

  for (const [textureIndex, texture] of textures.entries()) {
    rejectDecoderExtensions(extensionNames(texture, `textures[${textureIndex}]`), `textures[${textureIndex}]`);
    objectIndex(texture, 'sampler', samplers.length, `textures[${textureIndex}].sampler`);
    objectIndex(texture, 'source', images.length, `textures[${textureIndex}].source`);
  }

  for (const [imageIndex, image] of images.entries()) {
    if (image.uri !== undefined) {
      if (typeof image.uri !== 'string' || !image.uri.startsWith('data:')) {
        invalid(`GLB 的 images[${imageIndex}] 引用了外部资源，当前只接受内嵌数据。`);
      }
    } else if (objectIndex(image, 'bufferView', recordArray(json.bufferViews, 'bufferViews').length,
      `images[${imageIndex}].bufferView`) === undefined) {
      invalid(`GLB 的 images[${imageIndex}] 缺少内嵌数据来源。`);
    }
    const mimeType = image.mimeType;
    if (mimeType !== undefined) {
      if (typeof mimeType !== 'string') invalid(`GLB 的 images[${imageIndex}].mimeType 无效。`);
      if (/ktx|basis/i.test(mimeType)) invalid(`GLB 的 images[${imageIndex}] 使用了不支持的 KTX/Basis 纹理。`);
    }
  }
}

/**
 * Minimal loadability check before a generated model becomes a stored asset.
 * Validates the reference graph (scene → node → mesh → primitive → POSITION
 * accessor → bufferView → BIN chunk) against the viewer's bare GLTFLoader
 * capability set; Draco/Meshopt/KTX2 are rejected even when under-declared.
 * It does not prove visual quality or real-world scale.
 */
export function validateGlb(bytes: Uint8Array, maxBytes: number): HunyuanGlbStats {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Hunyuan3DError('INPUT_INVALID', 'GLB 大小上限无效。');
  }
  if (bytes.byteLength === 0) invalid('生成模型为空。');
  if (bytes.byteLength > maxBytes) invalid('生成模型超过当前允许的下载大小。');
  if (bytes.byteLength < 12) invalid('生成模型不是完整的 GLB。');

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) invalid('生成模型缺少 GLB 文件签名。');
  if (buffer.readUInt32LE(4) !== 2) invalid('仅接受 GLB 版本 2。');
  if (buffer.readUInt32LE(8) !== buffer.byteLength) invalid('GLB 声明长度与文件长度不一致。');

  const { json, binChunk } = parseContainer(buffer);
  if (!isRecord(json.asset) || typeof json.asset.version !== 'string' || !json.asset.version.startsWith('2.')) {
    invalid('GLB 缺少 glTF 2.x asset 版本。');
  }

  const extensionsUsed = stringArray(json.extensionsUsed, 'extensionsUsed');
  const extensionsRequired = stringArray(json.extensionsRequired, 'extensionsRequired');
  for (const name of extensionsRequired) {
    if (!ALLOWED_REQUIRED_EXTENSIONS.has(name)) invalid(`当前加载链不支持必需的扩展：${name}`);
  }

  const bufferViewCount = { value: 0 };
  validateBufferAndViews(json, binChunk, bufferViewCount);
  validateAccessors(json, bufferViewCount.value);
  const meshes = recordArray(json.meshes, 'meshes');
  const materials = recordArray(json.materials, 'materials');
  validateMeshes(json, recordArray(json.accessors, 'accessors').length, materials.length);
  validateMaterialsAndTextures(json);

  // 场景可达性：默认场景（或全部根节点）必须能走到至少一个带 POSITION 的 primitive。
  const nodes = recordArray(json.nodes, 'nodes');
  const scenes = recordArray(json.scenes, 'scenes');
  let rootIndices: number[];
  if (json.scene !== undefined) {
    const sceneIndex = json.scene;
    if (!Number.isInteger(sceneIndex) || (sceneIndex as number) < 0 || (sceneIndex as number) >= scenes.length) {
      invalid('GLB 的默认 scene 索引越界。');
    }
    rootIndices = nodeIndicesOf(scenes[sceneIndex as number], `scenes[${String(sceneIndex)}].nodes`, nodes.length);
  } else if (scenes.length > 0) {
    rootIndices = nodeIndicesOf(scenes[0], 'scenes[0].nodes', nodes.length);
  } else if (nodes.length > 0) {
    rootIndices = nodes.map((_, index) => index);
  } else {
    invalid('GLB 没有可加载的场景节点。');
  }

  const completed = new Set<number>();
  const inProgress = new Set<number>();
  const reachablePrimitives: Record<string, unknown>[] = [];
  const walk = (nodeIndex: number): void => {
    if (completed.has(nodeIndex)) return;
    if (inProgress.has(nodeIndex)) invalid('GLB 的节点引用成环。');
    inProgress.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (node === undefined) invalid(`GLB 的 nodes[${nodeIndex}] 不存在。`);
    const meshIndex = objectIndex(node, 'mesh', meshes.length, `nodes[${nodeIndex}].mesh`);
    if (meshIndex !== undefined) {
      const mesh = meshes[meshIndex];
      if (mesh === undefined) invalid(`GLB 的 nodes[${nodeIndex}].mesh 索引越界。`);
      reachablePrimitives.push(...requirePrimitiveArray(mesh.primitives, `meshes[${meshIndex}].primitives`));
    }
    const children = node.children;
    if (children !== undefined) {
      if (!Array.isArray(children)) invalid(`GLB 的 nodes[${nodeIndex}].children 必须是数组。`);
      for (const child of children) {
        if (!Number.isInteger(child) || (child as number) < 0 || (child as number) >= nodes.length) {
          invalid(`GLB 的 nodes[${nodeIndex}].children 索引越界。`);
        }
        walk(child as number);
      }
    }
    inProgress.delete(nodeIndex);
    completed.add(nodeIndex);
  };
  for (const root of rootIndices) walk(root);

  const accessors = recordArray(json.accessors, 'accessors');
  if (reachablePrimitives.length === 0) invalid('GLB 没有可达的几何体。');
  for (const primitive of reachablePrimitives) {
    const attributes = primitive.attributes;
    if (!isRecord(attributes) || attributes.POSITION === undefined) invalid('GLB 的可达 primitive 缺少 POSITION。');
    const positionIndex = objectIndex(attributes, 'POSITION', accessors.length, 'primitive.attributes.POSITION');
    if (positionIndex === undefined) invalid('GLB 的可达 primitive 缺少 POSITION。');
    const accessor = accessors[positionIndex];
    if (accessor === undefined || accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
      invalid('GLB 的 POSITION 必须是 FLOAT VEC3 accessor。');
    }
  }

  return {
    byteLength: buffer.byteLength,
    meshCount: meshes.length,
    materialCount: materials.length,
    imageCount: recordArray(json.images, 'images').length,
    extensionsUsed,
    extensionsRequired,
  };
}

function nodeIndicesOf(scene: Record<string, unknown> | undefined, field: string, nodeCount: number): number[] {
  if (scene === undefined) return invalid(`GLB 的 ${field} 场景不存在。`);
  const children = scene.nodes;
  if (!Array.isArray(children)) return invalid(`GLB 的 ${field} 必须是节点索引数组。`);
  const indices: number[] = [];
  for (const child of children) {
    if (!Number.isInteger(child) || (child as number) < 0 || (child as number) >= nodeCount) {
      return invalid(`GLB 的 ${field} 索引越界。`);
    }
    indices.push(child as number);
  }
  return indices;
}
