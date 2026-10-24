import { validateGlb } from './glb';
import { Hunyuan3DError } from './errors';
import { buildAuthorization, CONTENT_TYPE } from './sign';
import { assertProviderResultUrl } from './url-policy';
import {
  HUNYUAN_3D_ENDPOINT,
  HUNYUAN_3D_VERSION,
  HUNYUAN_IMAGE_MAX_BYTES,
  HUNYUAN_IMAGE_MAX_PX,
  HUNYUAN_IMAGE_MIN_PX,
  type Hunyuan3DClient,
  type Hunyuan3DConfig,
  type HunyuanFile,
  type HunyuanGenerationInput,
  type HunyuanJob,
  type HunyuanJobStatus,
} from './types';

const SUBMIT_ACTION = 'SubmitHunyuanTo3DProJob';
const QUERY_ACTION = 'QueryHunyuanTo3DProJob';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(message: string): never {
  throw new Hunyuan3DError('CONFIG_INVALID', message);
}

function inputError(message: string): never {
  throw new Hunyuan3DError('INPUT_INVALID', message);
}

function upstreamError(message: string, upstreamCode?: string): never {
  throw new Hunyuan3DError('UPSTREAM_ERROR', message, upstreamCode === undefined ? undefined : { upstreamCode });
}

function isJobStatus(value: unknown): value is HunyuanJobStatus {
  return value === 'WAIT' || value === 'RUN' || value === 'FAIL' || value === 'DONE';
}

function timeoutError(): never {
  throw new Hunyuan3DError('TIMEOUT', '混元 3D 请求超时。');
}

function resolveConfig(config: Hunyuan3DConfig) {
  const secretId = config.secretId.trim();
  const secretKey = config.secretKey.trim();
  const region = config.region.trim();
  if (!secretId || !secretKey || !region) configError('混元 3D 的 SecretId、SecretKey 和 Region 必须配置。');
  if (/[\r\n]/.test(secretId) || /[\r\n]/.test(secretKey)) configError('混元 3D 凭据不能包含换行。');

  const endpoint = new URL(config.endpoint ?? HUNYUAN_3D_ENDPOINT);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    configError('混元 3D endpoint 必须是根路径的 http(s) 地址。');
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    configError('混元 3D 超时必须是 1000 至 120000 毫秒的整数。');
  }
  const maxDownloadBytes = config.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  if (!Number.isInteger(maxDownloadBytes) || maxDownloadBytes < 1) configError('混元 3D 下载上限无效。');

  return { secretId, secretKey, region, endpoint, timeoutMs, maxDownloadBytes, model: config.model, resultUrlPolicy: config.resultUrlPolicy };
}

function validateInput(input: HunyuanGenerationInput, configuredModel: '3.0' | '3.1' | undefined) {
  const { bytes, mime, width, height } = input.image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < HUNYUAN_IMAGE_MIN_PX ||
    height < HUNYUAN_IMAGE_MIN_PX || width > HUNYUAN_IMAGE_MAX_PX || height > HUNYUAN_IMAGE_MAX_PX) {
    inputError(`混元 3D 输入图片每边必须为 ${HUNYUAN_IMAGE_MIN_PX} 至 ${HUNYUAN_IMAGE_MAX_PX} 像素。`);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) inputError('混元 3D 输入图片必须是 JPEG、PNG 或 WebP。');
  if (bytes.byteLength === 0 || bytes.byteLength > HUNYUAN_IMAGE_MAX_BYTES) {
    inputError(`混元 3D 输入图片不能为空或超过 ${HUNYUAN_IMAGE_MAX_BYTES} 字节。`);
  }
  if (input.generateType !== undefined && !['Normal', 'LowPoly', 'Geometry', 'Sketch'].includes(input.generateType)) {
    inputError('GenerateType 无效。');
  }
  if (input.faceCount !== undefined && (!Number.isInteger(input.faceCount) || input.faceCount < 3_000 || input.faceCount > 1_500_000)) {
    inputError('FaceCount 必须是 3000 至 1500000 的整数。');
  }
  const model = input.model ?? configuredModel;
  if (model !== undefined && !['3.0', '3.1'].includes(model)) inputError('混元 3D 模型版本必须是 3.0 或 3.1。');
  return model;
}

function bodyForSubmit(input: HunyuanGenerationInput, model: '3.0' | '3.1' | undefined): string {
  const body: Record<string, unknown> = {
    // The API accepts raw base64 here; a data: URI is not required by the documented contract.
    ImageBase64: Buffer.from(input.image.bytes).toString('base64'),
  };
  if (input.generateType !== undefined) body.GenerateType = input.generateType;
  if (input.enablePbr !== undefined) body.EnablePBR = input.enablePbr;
  if (input.faceCount !== undefined) body.FaceCount = input.faceCount;
  if (model !== undefined) body.Model = model;
  // No ResultFormat is sent: Pro returns OBJ and GLB by default. GLB is selected from ResultFile3Ds.
  return JSON.stringify(body);
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.Response)) upstreamError('混元 3D 返回结构无效。');
  const response = value.Response;
  if (isRecord(response.Error)) {
    const code = typeof response.Error.Code === 'string' ? response.Error.Code : undefined;
    upstreamError('混元 3D 服务返回错误。', code);
  }
  return response;
}

/**
 * Streams the body while enforcing a real byte cap: oversized responses are
 * cancelled mid-read instead of being buffered in full first. Returns
 * undefined when the response has no body at all.
 */
async function readResponseBytes(
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

export function createHunyuan3DClient(config: Hunyuan3DConfig): Hunyuan3DClient {
  const resolved = resolveConfig(config);

  async function call(action: string, body: string): Promise<Record<string, unknown>> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const authorization = buildAuthorization({
      secretId: resolved.secretId,
      secretKey: resolved.secretKey,
      host: resolved.endpoint.host,
      action,
      timestamp,
      body,
    });
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, resolved.timeoutMs);
    try {
      const response = await fetch(resolved.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': CONTENT_TYPE,
          'X-TC-Action': action,
          'X-TC-Version': HUNYUAN_3D_VERSION,
          'X-TC-Timestamp': timestamp,
          'X-TC-Region': resolved.region,
          Authorization: authorization,
        },
        body,
      });
      if (!response.ok) upstreamError('混元 3D 服务返回 HTTP 错误。');
      const bytes = await readResponseBytes(response, MAX_UPSTREAM_RESPONSE_BYTES, () =>
        new Hunyuan3DError('UPSTREAM_ERROR', '混元 3D 返回内容无效。'));
      if (bytes === undefined || bytes.length === 0) upstreamError('混元 3D 返回内容无效。');
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        upstreamError('混元 3D 返回内容不是 JSON。');
      }
      return responseRecord(parsed);
    } catch (error) {
      if (error instanceof Hunyuan3DError) throw error;
      if (timedOut) timeoutError();
      throw new Hunyuan3DError('UPSTREAM_ERROR', '混元 3D 网络请求失败。', { cause: error });
    } finally {
      // 状态码或 Content-Length 提前拒绝时，响应体可能仍在持续发送。
      controller.abort();
      clearTimeout(timer);
    }
  }

  return {
    async submitImage(input: HunyuanGenerationInput): Promise<{ jobId: string; requestId?: string }> {
      const model = validateInput(input, resolved.model);
      const response = await call(SUBMIT_ACTION, bodyForSubmit(input, model));
      if (typeof response.JobId !== 'string' || response.JobId.length === 0) upstreamError('混元 3D 未返回 JobId。');
      const result: { jobId: string; requestId?: string } = { jobId: response.JobId };
      if (typeof response.RequestId === 'string') result.requestId = response.RequestId;
      return result;
    },

    async queryJob(jobId: string): Promise<HunyuanJob> {
      const id = jobId.trim();
      if (id.length === 0) inputError('JobId 不能为空。');
      const response = await call(QUERY_ACTION, JSON.stringify({ JobId: id }));
      const status = response.Status;
      if (!isJobStatus(status)) upstreamError('混元 3D 返回了未知任务状态。');
      const files: HunyuanFile[] = [];
      if (response.ResultFile3Ds !== undefined) {
        if (!Array.isArray(response.ResultFile3Ds)) upstreamError('混元 3D 结果文件结构无效。');
        for (const entry of response.ResultFile3Ds) {
          if (!isRecord(entry) || typeof entry.Type !== 'string' || typeof entry.Url !== 'string') {
            upstreamError('混元 3D 结果文件条目无效。');
          }
          const file: HunyuanFile = { type: entry.Type, url: entry.Url };
          if (typeof entry.PreviewImageUrl === 'string') file.previewImageUrl = entry.PreviewImageUrl;
          files.push(file);
        }
      }
      if (status === 'DONE' && files.length === 0) throw new Hunyuan3DError('RESULT_MISSING', '混元 3D 任务已完成但没有结果文件。');
      const result: HunyuanJob = { jobId: id, status, files };
      if (typeof response.ErrorCode === 'string') result.errorCode = response.ErrorCode;
      if (typeof response.ErrorMessage === 'string') result.errorMessage = response.ErrorMessage;
      if (typeof response.ResultCreditConsumed === 'number') result.creditsConsumed = response.ResultCreditConsumed;
      return result;
    },

    async downloadGlb(file: HunyuanFile): Promise<{ bytes: Uint8Array; stats: ReturnType<typeof validateGlb> }> {
      if (file.type.toLowerCase() !== 'glb') throw new Hunyuan3DError('RESULT_MISSING', '结果中没有 GLB 文件。');
      let url: URL;
      try {
        url = new URL(file.url);
      } catch {
        throw new Hunyuan3DError('RESULT_URL_REJECTED', 'GLB 下载地址无效。');
      }
      const resultUrlPolicy = resolved.resultUrlPolicy ?? assertProviderResultUrl;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, resolved.timeoutMs);
      try {
        await resultUrlPolicy(url);
        const response = await fetch(url, { redirect: 'error', signal: controller.signal });
        if (!response.ok) throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 下载失败。');
        const bytes = await readResponseBytes(response, resolved.maxDownloadBytes, () =>
          new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 超过允许的下载大小。'));
        if (bytes === undefined) throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 响应没有内容。');
        return { bytes, stats: validateGlb(bytes, resolved.maxDownloadBytes) };
      } catch (error) {
        if (error instanceof Hunyuan3DError) throw error;
        if (timedOut) timeoutError();
        throw new Hunyuan3DError('DOWNLOAD_FAILED', 'GLB 下载失败。', { cause: error });
      } finally {
        controller.abort();
        clearTimeout(timer);
      }
    },
  };
}
