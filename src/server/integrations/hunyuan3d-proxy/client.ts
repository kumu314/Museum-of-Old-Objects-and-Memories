import { randomBytes } from 'node:crypto';
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
 * 编排层通过提交抢占与任务记录钩子持久化纹理阶段，防止重启重复付费。
 * 提交结果不明保持运行中，仅查询上游作品以恢复状态，不重新提交。
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

/**
 * 上游 concept 接口会把多个 JSON 文档直接拼接返回（同一行内没有分隔符），
 * JSON.parse 会报 "Extra data"。这里按括号深度切出每个完整文档；无法解析
 * 的片段忽略，由调用方判断是否拿到了可用内容。
 */
export function parseJsonDocuments(text: string): unknown[] {
  const documents: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { documents.push(JSON.parse(text.slice(start, index + 1))); }
        catch { /* 跳过不完整或损坏片段 */ }
        start = -1;
      }
    }
  }
  return documents;
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

/** 真实作品把失败原因放在 modelInfo.errorCode/errorMsg（如几何阶段 400）。 */
function failureFromModelInfo(item: Record<string, unknown>): { code: string; message: string } | undefined {
  const modelInfo = isRecord(item.modelInfo) ? item.modelInfo : undefined;
  if (modelInfo === undefined) return undefined;
  // 真实响应里 errorCode 是数字（如 400），这里统一转成字符串。
  const numeric = (value: unknown) => typeof value === 'number' ? String(value) : asString(value);
  const code = numeric(modelInfo.errorCode) ?? numeric(item.errorCode);
  const message = asString(modelInfo.errorMsg) ?? asString(item.errorMsg) ?? asString(item.statusMsg);
  if (code === undefined && message === undefined) return undefined;
  return { code: code ?? 'UPSTREAM_STAGE_FAILED', message: message ?? '上游任务执行失败，可重新生成。' };
}

function failedJob(worksId: string, item: Record<string, unknown>): HunyuanJob {
  const job: HunyuanJob = { jobId: worksId, status: 'FAIL', files: [] };
  const failure = failureFromModelInfo(item);
  const code = failure?.code ?? asString(item.errorCode);
  if (code !== undefined) job.errorCode = code;
  const message = failure?.message ?? asString(item.errorMsg) ?? asString(item.statusMsg);
  if (message !== undefined) job.errorMessage = message;
  return job;
}

export function createHunyuanWebProxyClient(config: HunyuanProxyConfig): HunyuanProxyClient {
  const resolved = resolveConfig(config);
  const textureStarts = new Map<string, Promise<void>>();

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
  ): Promise<{ status: number; text: string }> {
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
      const text = bytes.byteLength > 0 ? new TextDecoder().decode(bytes) : '';
      return { status: response.status, text };
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
    const { status, text } = await request(body === undefined ? 'GET' : 'POST', path,
      body === undefined ? undefined : JSON.stringify(body));
    const json = parseJsonDocuments(text)[0];
    if (status >= 400 || !isRecord(json) || json.ok !== true) {
      const message = isRecord(json) && typeof json.error === 'string' ? json.error : undefined;
      upstreamError(message === undefined ? '混元 3D 反代返回错误。' : `混元 3D 反代返回错误：${message}`);
    }
    return json.data;
  }

  /**
   * concept 上游透传端点。真实响应有三种形状：标准 {errNo,data} 信封、
   * 成功时直接返回裸对象（如提交返回 {worksId,...}），以及多个文档拼接。
   * 成功判定优先于 HTTP 状态：上游用 4xx 携带 {errNo,errMsg} 说明拒绝原因。
   */
  async function conceptUpstream(path: string, body: Record<string, unknown>): Promise<unknown> {
    const { text } = await request('POST', path, JSON.stringify(body));
    const documents = parseJsonDocuments(text);
    const success = documents.find((doc): doc is Record<string, unknown> =>
      isRecord(doc) && (doc.errNo === 0 || typeof doc.worksId === 'string'
        || (isRecord(doc.data) && Array.isArray(doc.data.list))));
    if (success !== undefined) return isRecord(success.data) ? success.data : success;
    const rejection = documents.find((doc): doc is Record<string, unknown> =>
      isRecord(doc) && typeof doc.errNo === 'number' && doc.errNo !== 0);
    if (rejection !== undefined) {
      const message = typeof rejection.errMsg === 'string' && rejection.errMsg.length > 0 ? rejection.errMsg : '上游拒绝请求。';
      upstreamError(`混元 3D 上游拒绝请求：${message}`, String(rejection.errNo));
    }
    upstreamError('混元 3D 反代返回结构无效。');
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
    const { status, text } = await request('POST', '/api/3d/resource/genUploadInfo', JSON.stringify({ fileName }));
    const json = parseJsonDocuments(text)[0];
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

  /** 提交前持久化抢占；响应丢失或记录失败仍保留抢占，轮询只做上游对账。 */
  async function startTextureStage(geometryWorksId: string): Promise<void> {
    let tracked = textureStarts.get(geometryWorksId);
    if (tracked === undefined) {
      tracked = (async () => {
        if (config.claimTextureSubmission !== undefined &&
          !await config.claimTextureSubmission(geometryWorksId)) return;
        const submission = await proxyLocal('/api/text3d/texture', {
          worksId: geometryWorksId,
          method: 'image',
          modelVersion: resolved.modelVersion,
        });
        if (!isRecord(submission) || typeof submission.status !== 'number' ||
          submission.status < 200 || submission.status >= 300 || !isRecord(submission.body)) {
          upstreamError('纹理阶段未返回有效的上游提交结果。');
        }
        const body = submission.body;
        if (body.errNo !== undefined && body.errNo !== 0) upstreamError('纹理阶段提交被上游拒绝。');
        const result = isRecord(body.data) ? body.data : body;
        const textureId = asString(result.worksId);
        if (textureId === undefined) upstreamError('纹理阶段提交未返回 worksId。');
        await config.recordTextureSubmission?.(geometryWorksId, textureId);
      })();
      textureStarts.set(geometryWorksId, tracked);
    }
    // rejected promise 同样保留：外部可能已受理，不允许后续轮询重新付费提交。
    await tracked;
  }

  return {
    async submitImage(input: HunyuanGenerationInput): Promise<{ jobId: string; requestId?: string }> {
      assertValidGenerationImage(input.image);
      await assertLoggedIn();
      const resourceUrl = await uploadImage(input.image);
      // 真实上游要求 requestId（缺失时返回 errNo 200002 输入参数错误）。
      const requestId = `go${randomBytes(6).toString('hex')}`;
      const data = await conceptUpstream('/game3d/geometry_generation/image2geometry', {
        singleImage: resourceUrl,
        modelVersion: resolved.modelVersion,
        faceCount: resolved.faceCount,
        requestId,
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
      const geometryStatus = mapPipelineStatus(geometryItem.pipelineStatus ?? geometryItem.status);
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
        const textureId = asString(textureItem.worksId);
        if (textureId !== undefined) await config.recordTextureSubmission?.(id, textureId);
        const textureStatus = mapPipelineStatus(textureItem.pipelineStatus ?? textureItem.status);
        if (textureStatus === undefined) upstreamError('混元 3D 上游返回了未知任务状态。');
        if (!textureStatus.terminal) return { jobId: id, status: textureStatus.status, files: [] };
        if (textureStatus.status === 'FAIL') return failedJob(id, textureItem);
        const modelInfo = isRecord(textureItem.modelInfo) ? textureItem.modelInfo : {};
        const file = glbFileFromStage(modelInfo.texturePaintingRsp);
        if (file === undefined) throw new Hunyuan3DError('RESULT_MISSING', '混元 3D 任务已完成但没有结果文件。');
        return { jobId: id, status: 'DONE', files: [file] };
      }

      // 缺少作品可能只是上游列表延迟；提交异常不等于任务失败，保留待核对状态。
      try {
        await startTextureStage(id);
      } catch {
        return { jobId: id, status: 'RUN', files: [], errorCode: 'TEXTURE_SUBMIT_UNKNOWN',
          errorMessage: '纹理提交结果尚未确认，正在核对上游任务，不会重复提交。' };
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
