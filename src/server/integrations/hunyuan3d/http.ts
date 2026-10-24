import { validateGlb } from './glb';
import { Hunyuan3DError } from './errors';
import { assertProviderResultUrl, type HunyuanResultUrlPolicy } from './url-policy';
import type { HunyuanGlbStats } from './types';

/**
 * Streams the body while enforcing a real byte cap: oversized responses are
 * cancelled mid-read instead of being buffered in full first. Returns
 * undefined when the response has no body at all.
 */
export async function readResponseBytes(
  response: Response,
  maxBytes: number,
  oversize: () => Hunyuan3DError,
): Promise<Buffer | undefined> {
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (Number.isInteger(declared) && declared >= 0 && declared > maxBytes) throw oversize();
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw oversize();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export type GlbDownloadLimits = {
  timeoutMs: number;
  maxDownloadBytes: number;
  resultUrlPolicy?: HunyuanResultUrlPolicy | undefined;
};

function timeoutError(): never {
  throw new Hunyuan3DError('TIMEOUT', '混元 3D 请求超时。');
}

/**
 * 供应商结果下载的统一路径：先执行下载来源策略，再以流式字节上限读取，
 * 最后做 GLB 可加载性校验。云 API 与网页反代两个通道共用，避免两套
 * 上限与校验逻辑分叉。
 */
export async function downloadValidatedGlb(
  url: URL,
  limits: GlbDownloadLimits,
): Promise<{ bytes: Uint8Array; stats: HunyuanGlbStats }> {
  const resultUrlPolicy = limits.resultUrlPolicy ?? assertProviderResultUrl;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);
  try {
    await resultUrlPolicy(url);
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 下载失败。');
    const bytes = await readResponseBytes(response, limits.maxDownloadBytes, () =>
      new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 超过允许的下载大小。'));
    if (bytes === undefined) throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 响应没有内容。');
    return { bytes, stats: validateGlb(bytes, limits.maxDownloadBytes) };
  } catch (error) {
    if (error instanceof Hunyuan3DError) throw error;
    if (timedOut) timeoutError();
    throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 下载失败。', { cause: error });
  } finally {
    // 状态码、来源策略或 Content-Length 提前拒绝时，响应体可能仍在持续发送。
    controller.abort();
    clearTimeout(timer);
  }
}
