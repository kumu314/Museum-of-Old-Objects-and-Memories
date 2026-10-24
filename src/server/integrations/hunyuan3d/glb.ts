import { Hunyuan3DError } from './errors';
import type { HunyuanGlbStats } from './types';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

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

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function assertEmbeddedResources(value: unknown, field: 'buffers' | 'images'): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalid(`GLB 的 ${field} 必须是数组。`);
  for (const entry of value) {
    if (!isRecord(entry)) invalid(`GLB 的 ${field} 条目无效。`);
    if (entry.uri === undefined) continue;
    if (typeof entry.uri !== 'string') invalid(`GLB 的 ${field}.uri 无效。`);
    if (entry.uri.startsWith('data:')) continue;
    invalid(`GLB 的 ${field} 引用了外部资源，当前只接受内嵌数据。`);
  }
}

/**
 * Minimal GLB trust-boundary check before a generated model becomes a stored asset.
 * It does not prove visual quality or real-world scale. Draco/KTX2 are rejected
 * because the current viewer has no DRACOLoader/KTX2Loader configured.
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

  let offset = 12;
  let json: unknown;
  let sawJson = false;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) invalid('GLB 分块头不完整。');
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > buffer.byteLength) invalid('GLB 分块长度越界。');
    if (!sawJson) {
      if (chunkType !== JSON_CHUNK) invalid('GLB 第一个分块必须是 JSON。');
      try {
        json = JSON.parse(buffer.toString('utf8', dataStart, dataEnd).replace(/\u0000+$/g, '').trim());
      } catch {
        invalid('GLB 的 JSON 分块无法解析。');
      }
      sawJson = true;
    } else if (chunkType !== BIN_CHUNK) {
      invalid('GLB 包含未知分块类型。');
    }
    offset = dataEnd;
  }
  if (!sawJson) invalid('GLB 缺少 JSON 分块。');
  if (!isRecord(json) || !isRecord(json.asset) || typeof json.asset.version !== 'string' ||
    !json.asset.version.startsWith('2.')) {
    invalid('GLB 缺少 glTF 2.x asset 版本。');
  }

  const extensionsUsed = stringArray(json.extensionsUsed, 'extensionsUsed');
  const extensionsRequired = stringArray(json.extensionsRequired, 'extensionsRequired');
  const unsupported = extensionsRequired.filter((extension) => /draco|texture_basisu/i.test(extension));
  if (unsupported.length > 0) {
    invalid(`当前加载链不支持必需的扩展：${unsupported.join(', ')}`);
  }
  assertEmbeddedResources(json.buffers, 'buffers');
  assertEmbeddedResources(json.images, 'images');

  return {
    byteLength: buffer.byteLength,
    meshCount: countArray(json.meshes),
    materialCount: countArray(json.materials),
    imageCount: countArray(json.images),
    extensionsUsed,
    extensionsRequired,
  };
}
