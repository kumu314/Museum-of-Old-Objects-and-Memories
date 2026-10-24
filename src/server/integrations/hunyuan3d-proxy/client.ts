import { Hunyuan3DError } from '../hunyuan3d/errors';
import { assertValidGenerationImage } from '../hunyuan3d/input';
import { downloadValidatedGlb } from '../hunyuan3d/http';
import type {
  HunyuanFile,
  HunyuanGenerationInput,
  HunyuanGlbStats,
  HunyuanJob,
  HunyuanJobStatus,
} from '../hunyuan3d/types';
import { cosUploadHeaders, parseCosUploadInfo, uploadFileNameFor } from './cos';
import {
  HUNYUAN_PROXY_DEFAULT_FACE_COUNT,
  HUNYUAN_PROXY_DEFAULT_MAX_DOWNLOAD_BYTES,
  HUNYUAN_PROXY_DEFAULT_MODEL_VERSION,
  HUNYUAN_PROXY_DEFAULT_TIMEOUT_MS,
  type HunyuanProxyClient,
  type HunyuanProxyConfig,
} from './types';
import { isTencentCosResultHost } from '../hunyuan3d/url-policy';

/**
 * concept 网页反代适配器（演示路径）。
 *
 * 完整管线是两阶段异步任务：
 *   上传照片 → image2geometry（白模）→ /api/text3d/texture（图生纹理）→ 成品 PBR GLB
 *
 * 对上层（C 的任务编排）仍呈现单一的 jobId（几何 worksId）：纹理阶段由
 * queryJob 在几何完成后自动接续，纹理作品通过 dependonWorksInfo 关联找到，
 * 演示期间复用同一客户端实例；接入持久化编排前仍需保存纹理提交记录。
 * 提交失败按任务失败上报，重建实例或进程重启后须先核对上游结果。
 *
 * ⚠️ 上游是逆向的网页端接口（个人 Cookie 会话），仅用于演示；生产路径仍是
 * 官方云 API 适配器。Cookie 属于凭据，绝不进入本仓库、客户端或日志。
 */

const PIPELINE_STATUS = { PENDING: 0, PROCESSING: 1, SUCCESS: 2, FAILED: 3, CANCEL: 4, DELETED: 5 } as const;
const TEXTURE_PIPELINE = 6;

type ResolvedConfig = {
  baseUrl: URL;
  timeoutMs: number;
  maxDownloadBytes: number;
  modelVersion: string;
  faceCount: number;
  cosHostPolicy: (url: URL) => void;
  resultUrlPolicy: HunyuanProxyConfig['resultUrlPolicy'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(message: string): never {
  throw new Hunyuan3DError('CONFIG_INVALID', message);
}

function upstreamError(message: string, upstreamCode?: string): never {
  throw new Hunyuan3DError('UPSTREAM_ERROR', message, upstreamCode === undefined ? undefined : { upstreamCode });
}

function timeoutError(): never {
  throw new Hunyuan3DError('TIMEOUT', '混元 3D 反代请求超时。');
}

function defaultCosHostPolicy(url: URL): void {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    throw new Hunyuan3DError('UPSTREAM_ERROR', '上传地址必须使用不携带凭据或非默认端口的 HTTPS。');
  }
  if (!isTencentCosResultHost(url.hostname)) {
    throw new Hunyuan3DError('UPSTREAM_ERROR', '上传地址不在允许的腾讯 COS 来源内。');
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveConfig(config: HunyuanProxyConfig): ResolvedConfig {
  const rawBase = config.baseUrl.trim();
  if (rawBase.length === 0) configError('混元 3D 反代地址必须配置。');
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    configError('混元 3D 反代地址无效。');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    configError('混元 3D 反代地址必须是 http(s) 且不携带凭据。');
  }
  const timeoutMs = config.timeoutMs ?? HUNYUAN_PROXY_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    configError('混元 3D 反代超时必须是 1000 至 120000 毫秒的整数。');
  }
  const maxDownloadBytes = config.maxDownloadBytes ?? HUNYUAN_PROXY_DEFAULT_MAX_DOWNLOAD_BYTES;
  if (!Number.isInteger(maxDownloadBytes) || maxDownloadBytes < 1) configError('混元 3D 下载上限无效。');
  const modelVersion = config.modelVersion ?? HUNYUAN_PROXY_DEFAULT_MODEL_VERSION;
  const faceCount = config.faceCount ?? HUNYUAN_PROXY_DEFAULT_FACE_COUNT;
  if (!Number.isInteger(faceCount) || faceCount < 3_000 || faceCount > 1_500_000) {
    configError('faceCount 必须是 3000 至 1500000 的整数。');
  }
  return {
    baseUrl,
    timeoutMs,
    maxDownloadBytes,
    modelVersion,
    faceCount,
    cosHostPolicy: config.cosHostPolicy ?? defaultCosHostPolicy,
    resultUrlPolicy: config.resultUrlPolicy,
  };
}

type PipelineOutcome = { status: HunyuanJobStatus; terminal: boolean };

function mapPipelineStatus(value: unknown): PipelineOutcome | undefined {
  if (typeof value !== 'number') return undefined;
  switch (value) {
    case PIPELINE_STATUS.PENDING:
      return { status: 'WAIT', terminal: false };
    case PIPELINE_STATUS.PROCESSING:
      return { status: 'RUN', terminal: false };
    case PIPELINE_STATUS.SUCCESS:
      return { status: 'DONE', terminal: true };
    case PIPELINE_STATUS.FAILED:
    case PIPELINE_STATUS.CANCEL:
    case PIPELINE_STATUS.DELETED:
      return { status: 'FAIL', terminal: true };
    default:
      return undefined;
  }
}

function glbFileFromStage(stage: unknown): HunyuanFile | undefined {
  if (!isRecord(stage)) return undefined;
  const url = asString(stage.glbUrl) ?? asString(stage.GlbUrl);
  if (url === undefined) return undefined;
  const file: HunyuanFile = { type: 'GLB', url };
  const preview = asString(stage.pbrImageUrl);
  if (preview !== undefined) file.previewImageUrl = preview;
  return file;
}

function dependsOn(item: Record<string, unknown>, worksId: string): boolean {
  for (const key of ['dependonWorksInfo', 'dependOnWorksInfo', 'inputInfo']) {
    const candidate = item[key];
    if (!isRecord(candidate)) continue;
    for (const value of Object.values(candidate)) {
      if (value === worksId) return true;
    }
  }
  return false;
}

function failedJob(worksId: string, item: Record<string, unknown>): HunyuanJob {
  const job: HunyuanJob = { jobId: worksId, status: 'FAIL', files: [] };
  const code = asString(item.errorCode);
  if (code !== undefined) job.errorCode = code;
  const message = asString(item.errorMsg) ?? asString(item.statusMsg);
  if (message !== undefined) job.errorMessage = message;
  return job;
}

export function createHunyuanWebProxyClient(config: HunyuanProxyConfig): HunyuanProxyClient {
  const resolved = resolveConfig(config);
  const textureStarts = new Map<string, Promise<'started' | 'failed'>>();
  const textureStartFailed = new Set<string>();

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
  ): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, resolved.timeoutMs);
    try {
      const response = await fetch(new URL(path, resolved.baseUrl), {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
        ...(body === undefined ? {} : { body }),
      });
      const bytes = await response.arrayBuffer();
      let json: unknown = undefined;
      if (bytes.byteLength > 0) {
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          json = undefined;
        }
      }
      return { status: response.status, json };
    } catch (error) {
      if (error instanceof Hunyuan3DError) throw error;
      if (timedOut) timeoutError();
      throw new Hunyuan3DError('UPSTREAM_ERROR', '混元 3D 反代请求失败。', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 反代本地封装端点：{ok, data, error} 信封。 */
  async function proxyLocal(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const { status, json } = await request(body === undefined ? 'GET' : 'POST', path,
      body === undefined ? undefined : JSON.stringify(body));
    if (status >= 400 || !isRecord(json) || json.ok !== true) {
      const message = isRecord(json) && typeof json.error === 'string' ? json.error : undefined;
      upstreamError(message === undefined ? '混元 3D 反代返回错误。' : `混元 3D 反代返回错误：${message}`);
    }
    return json.data;
  }

  /** concept 上游透传端点：{errNo, errMsg, data} 信封，errNo===0 成功。 */
  async function conceptUpstream(path: string, body: Record<string, unknown>): Promise<unknown> {
    const { status, json } = await request('POST', path, JSON.stringify(body));
    if (status >= 400 || !isRecord(json) || typeof json.errNo !== 'number') {
      upstreamError('混元 3D 反代返回结构无效。');
    }
    if (json.errNo !== 0) {
      const message = typeof json.errMsg === 'string' && json.errMsg.length > 0 ? json.errMsg : '上游拒绝请求。';
      upstreamError(`混元 3D 上游拒绝请求：${message}`, String(json.errNo));
    }
    return json.data;
  }

  async function assertLoggedIn(): Promise<void> {
    const data = await proxyLocal('/api/login/status');
    if (!isRecord(data) || data.loggedIn !== true) {
      configError('混元 3D 反代会话未登录，请先在反代控制台完成登录。');
    }
  }

  async function uploadImage(image: HunyuanGenerationInput['image']): Promise<string> {
    const fileName = uploadFileNameFor(image);
    // 此路径由 ProxyMain 透传，不使用反代本地接口的 ok/data 信封。
    const { status, json } = await request('POST', '/api/3d/resource/genUploadInfo', JSON.stringify({ fileName }));
    if (status < 200 || status >= 300 || !isRecord(json) || json.ok === false) {
      upstreamError('混元 3D 上传凭证请求失败。');
    }
    const uploadInfo = isRecord(json.data) ? json.data : json;
    const info = parseCosUploadInfo(uploadInfo, image.mime, resolved.cosHostPolicy);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, resolved.timeoutMs);
    try {
      const response = await fetch(info.uploadUrl, {
        method: 'PUT',
        redirect: 'error',
        signal: controller.signal,
        headers: cosUploadHeaders(info),
        body: Buffer.from(image.bytes),
      });
      if (!response.ok) upstreamError('输入图片上传失败。');
    } catch (error) {
      if (error instanceof Hunyuan3DError) throw error;
      if (timedOut) timeoutError();
      upstreamError('输入图片上传失败。');
    } finally {
      clearTimeout(timer);
    }
    return info.resourceUrl;
  }

  /**
   * 实例内去重的纹理阶段提交：同一几何任务最多自动提交一次。已结算的
   * promise 保留在 map 中，轮询重复到达时直接复用结果；失败记入
   * textureStartFailed，后续轮询按任务失败上报，不自动重试。
   */
  async function startTextureStage(geometryWorksId: string): Promise<'started' | 'failed' | 'failed-before'> {
    if (textureStartFailed.has(geometryWorksId)) return 'failed-before';
    let tracked = textureStarts.get(geometryWorksId);
    if (tracked === undefined) {
      tracked = (async () => {
        const submission = await proxyLocal('/api/text3d/texture', {
          worksId: geometryWorksId,
          method: 'image',
          modelVersion: resolved.modelVersion,
        });
        // Go 反代的 ok 只表示本地封装成功，实际上游状态在 status/body 内。
        if (!isRecord(submission) || typeof submission.status !== 'number' ||
          submission.status < 200 || submission.status >= 300 || !isRecord(submission.body)) {
          upstreamError('纹理阶段未返回有效的上游提交结果。');
        }
        const body = submission.body;
        if (body.errNo !== undefined && body.errNo !== 0) upstreamError('纹理阶段提交被上游拒绝。');
        const result = isRecord(body.data) ? body.data : body;
        if (asString(result.worksId) === undefined) upstreamError('纹理阶段提交未返回 worksId。');
        return 'started' as const;
      })().catch(() => {
        textureStartFailed.add(geometryWorksId);
        return 'failed' as const;
      });
      textureStarts.set(geometryWorksId, tracked);
    }
    return tracked;
  }

  return {
    async submitImage(input: HunyuanGenerationInput): Promise<{ jobId: string; requestId?: string }> {
      assertValidGenerationImage(input.image);
      await assertLoggedIn();
      const resourceUrl = await uploadImage(input.image);
      const data = await conceptUpstream('/game3d/geometry_generation/image2geometry', {
        singleImage: resourceUrl,
        modelVersion: resolved.modelVersion,
        faceCount: resolved.faceCount,
      });
      const worksId = isRecord(data) ? asString(data.worksId) : undefined;
      if (worksId === undefined) upstreamError('混元 3D 上游未返回 worksId。');
      return { jobId: worksId };
    },

    async queryJob(jobId: string): Promise<HunyuanJob> {
      const id = jobId.trim();
      if (id.length === 0) throw new Hunyuan3DError('INPUT_INVALID', 'worksId 不能为空。');

      const geometryData = await conceptUpstream('/game3d/general_info/get_works_list', { worksIds: [id] });
      const geometryList = isRecord(geometryData) && Array.isArray(geometryData.list) ? geometryData.list : [];
      const geometryItem = geometryList.find((item): item is Record<string, unknown> =>
        isRecord(item) && item.worksId === id);
      if (geometryItem === undefined) upstreamError('混元 3D 上游找不到对应任务。');
      const geometryStatus = mapPipelineStatus(geometryItem.pipelineStatus);
      if (geometryStatus === undefined) upstreamError('混元 3D 上游返回了未知任务状态。');
      if (!geometryStatus.terminal) return { jobId: id, status: geometryStatus.status, files: [] };
      if (geometryStatus.status === 'FAIL') return failedJob(id, geometryItem);

      // 几何完成：查找已关联的纹理作品（worksPipeline=TEXTURE）。
      const textureData = await conceptUpstream('/game3d/general_info/get_works_list', { worksPipeline: TEXTURE_PIPELINE });
      if (!isRecord(textureData) || !Array.isArray(textureData.list)) upstreamError('混元 3D 纹理任务列表结构无效。');
      const textureList = textureData.list;
      const textureItem = textureList.find((item): item is Record<string, unknown> =>
        isRecord(item) && dependsOn(item, id));

      if (textureItem !== undefined) {
        const textureStatus = mapPipelineStatus(textureItem.pipelineStatus);
        if (textureStatus === undefined) upstreamError('混元 3D 上游返回了未知任务状态。');
        if (!textureStatus.terminal) return { jobId: id, status: textureStatus.status, files: [] };
        if (textureStatus.status === 'FAIL') return failedJob(id, textureItem);
        const modelInfo = isRecord(textureItem.modelInfo) ? textureItem.modelInfo : {};
        const file = glbFileFromStage(modelInfo.texturePaintingRsp);
        if (file === undefined) throw new Hunyuan3DError('RESULT_MISSING', '混元 3D 任务已完成但没有结果文件。');
        return { jobId: id, status: 'DONE', files: [file] };
      }

      // 几何完成但还没有纹理作品：自动接续纹理阶段（进程内去重）。
      const outcome = await startTextureStage(id);
      if (outcome !== 'started') {
        const job: HunyuanJob = { jobId: id, status: 'FAIL', files: [] };
        job.errorCode = 'TEXTURE_STAGE_SUBMIT_FAILED';
        job.errorMessage = '几何生成已完成，但纹理阶段提交失败；需显式重试，不会自动重复消耗积分。';
        return job;
      }
      return { jobId: id, status: 'RUN', files: [] };
    },

    async downloadGlb(file: HunyuanFile): Promise<{ bytes: Uint8Array; stats: HunyuanGlbStats }> {
      let url: URL;
      try {
        url = new URL(file.url);
      } catch {
        throw new Hunyuan3DError('RESULT_URL_REJECTED', 'GLB 下载地址无效。');
      }
      const result = await downloadValidatedGlb(url, {
        timeoutMs: resolved.timeoutMs,
        maxDownloadBytes: resolved.maxDownloadBytes,
        resultUrlPolicy: resolved.resultUrlPolicy,
      });
      // 反代文档的验收口径：白模同样有 glbUrl，materials>0 才算成品。
      if (result.stats.materialCount === 0) {
        throw new Hunyuan3DError('INVALID_GLB', '生成结果缺少纹理材质，可能只是白模。');
      }
      return result;
    },

    async remainingTimes(): Promise<number | undefined> {
      const data = await conceptUpstream('/game3d/general_info/get_remaining_times', {});
      return isRecord(data) && typeof data.remainingTimes === 'number' ? data.remainingTimes : undefined;
    },
  };
}
