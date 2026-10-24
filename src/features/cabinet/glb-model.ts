import { InstancedMesh, Mesh, Texture, type Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { z } from 'zod';
import { disposeResources } from './model-resources';

// Rendering input, not an HTTP or database contract. C resolves ownership and the URL.
export const glbModelSourceSchema = z.strictObject({
  assetId: z.string().min(1), version: z.string().min(1), url: z.string().min(1),
});
export type GlbModelSource = z.infer<typeof glbModelSourceSchema>;
export const modelBudget = { bytes: 32 * 1024 * 1024, triangles: 250_000, textureDimension: 4096, texturePixels: 32_000_000 } as const;
export interface ModelStats { triangles: number; textures: number; texturePixels: number }

export function resolveModelUrl(input: string, base: string): string {
  const origin = new URL(base);
  const url = new URL(input, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.origin || url.username || url.password) {
    throw new Error('模型必须通过本站授权的素材接口读取。');
  }
  return url.href;
}

const embeddedDocument = z.looseObject({
  asset: z.looseObject({ version: z.literal('2.0') }),
  scenes: z.array(z.unknown()).length(1),
  buffers: z.array(z.looseObject({ uri: z.never().optional() })).max(1).optional(),
  images: z.array(z.looseObject({ uri: z.never().optional(), bufferView: z.number().int().nonnegative() })).optional(),
});
/** A bounded, embedded-only GLB gate; full asset validation still belongs to C/D. */
export function checkGlbContainer(buffer: ArrayBuffer): void {
  if (buffer.byteLength > modelBudget.bytes) throw new Error('模型文件超过 32 MiB，请降低模型精度。');
  if (buffer.byteLength < 20) throw new Error('模型不是完整的 GLB 文件。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('模型不是有效的 GLB 2.0 文件。');
  let offset = 12;
  let chunks = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLB 数据块不完整。');
    const size = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (size % 4 !== 0 || offset + 8 + size > buffer.byteLength) throw new Error('GLB 数据块长度无效。');
    if (chunks === 0) {
      if (type !== 0x4e4f534a) throw new Error('GLB 缺少模型描述。');
      const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, offset + 8, size)));
      if (!embeddedDocument.safeParse(document).success) throw new Error('模型必须为 GLB 2.0，几何和贴图均需内嵌。');
    } else if (chunks !== 1 || type !== 0x004e4942) throw new Error('模型包含不支持的数据块。');
    offset += size + 8; chunks++;
  }
}

export async function readModelResponse(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`模型读取失败（HTTP ${response.status}）。`);
  if (Number(response.headers.get('content-length')) > modelBudget.bytes) {
    await response.body?.cancel(); throw new Error('模型文件超过 32 MiB，请降低模型精度。');
  }
  if (!response.body) throw new Error('模型响应没有内容。');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let cancellation: Promise<void> | null = null;
  const abort = () => { cancellation = reader.cancel(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > modelBudget.bytes) { await reader.cancel(); throw new Error('模型文件超过 32 MiB，请降低模型精度。'); }
      parts.push(result.value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    try { if (cancellation !== null) await cancellation; } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes.buffer;
}

function checkModelBudget(root: Group): ModelStats {
  let triangles = 0;
  const textures = new Set<Texture>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const count = node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0;
    triangles += count / 3 * (node instanceof InstancedMesh ? node.count : 1);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const values: readonly unknown[] = Object.values(material);
      for (const value of values) if (value instanceof Texture) textures.add(value);
    }
  });
  if (triangles > modelBudget.triangles) throw new Error('模型面数超过查看器预算，请简化后重试。');
  if (triangles <= 0) throw new Error('模型中没有可显示的三维几何体，请更换模型。');
  let texturePixels = 0;
  for (const texture of textures) {
    const dimensions = z.object({ width: z.number().positive(), height: z.number().positive() }).parse(texture.source.data);
    if (Math.max(dimensions.width, dimensions.height) > modelBudget.textureDimension) throw new Error('模型贴图超过 4096 像素，请缩小后重试。');
    texturePixels += dimensions.width * dimensions.height;
  }
  if (texturePixels > modelBudget.texturePixels) throw new Error('模型贴图总像素超过查看器预算，请简化后重试。');
  return { triangles: Math.ceil(triangles), textures: textures.size, texturePixels };
}

/** GLTF parsing is not abortable: ownership transfers only after the final signal check. */
export async function parseGlbModel(buffer: ArrayBuffer, signal: AbortSignal,
  parse: (buffer: ArrayBuffer) => Promise<Group> = async (data) => (await new GLTFLoader().parseAsync(data, '')).scene,
): Promise<{ object: Group; stats: ModelStats }> {
  checkGlbContainer(buffer); signal.throwIfAborted();
  const object = await parse(buffer);
  try {
    signal.throwIfAborted();
    return { object, stats: checkModelBudget(object) };
  } catch (error: unknown) { disposeResources(object); throw error; }
}

export async function loadGlbModel(input: GlbModelSource, signal: AbortSignal): Promise<{ object: Group; stats: ModelStats }> {
  const source = glbModelSourceSchema.parse(input);
  const url = resolveModelUrl(source.url, document.baseURI);
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer' });
  const buffer = await readModelResponse(response, signal);
  return parseGlbModel(buffer, signal);
}
