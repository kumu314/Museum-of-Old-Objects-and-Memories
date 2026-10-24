import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Hunyuan3DError } from '../hunyuan3d/errors';
import type { HunyuanGenerationInput } from '../hunyuan3d/types';

/**
 * 输入照片上传：反代提供 genUploadInfo 透传，返回腾讯 COS 临时凭证与目标；
 * 本模块用这些凭证直接 PUT 到 COS 拿到可引用的图片地址。
 *
 * ⚠️ 未验证项：凭证字段名（encryptTmpSecretId/Key/Token 等）来自网页 SPA
 * 的逆向记录，还没有真实响应样本。实现按别名容错解析；字段缺失时受控
 * 失败并提示，真实试跑后需要按实际响应核对一次。
 */

export type CosUploadInfo = {
  uploadUrl: URL;
  resourceUrl: string;
  secretId: string;
  secretKey: string;
  sessionToken?: string | undefined;
  contentType: string;
};

function cosError(message: string): never {
  throw new Hunyuan3DError('UPSTREAM_ERROR', message);
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function parseCosUploadInfo(raw: unknown, contentType: string, requireHost: (url: URL) => void): CosUploadInfo {
  if (typeof raw !== 'object' || raw === null) cosError('上传凭证响应无效。');
  const data = raw as Record<string, unknown>;
  const secretId = firstString(data, ['tmpSecretId', 'encryptTmpSecretId', 'secretId']);
  const secretKey = firstString(data, ['tmpSecretKey', 'encryptTmpSecretKey', 'secretKey']);
  const sessionToken = firstString(data, ['sessionToken', 'tmpSessionToken', 'encryptTmpSessionToken', 'Token']);
  const resourceUrl = firstString(data, ['resourceUrl', 'url']);
  const location = firstString(data, ['location', 'key']);
  const bucketName = firstString(data, ['bucketName', 'bucket']);
  const region = firstString(data, ['region']);

  if (secretId === undefined || secretKey === undefined) {
    cosError('上传凭证缺少临时密钥字段，需要按真实响应核对上传流程。');
  }

  let uploadUrl: URL | undefined;
  if (resourceUrl !== undefined) {
    try {
      const parsed = new URL(resourceUrl);
      if (parsed.pathname !== '/') uploadUrl = parsed;
    } catch {
      uploadUrl = undefined;
    }
  }
  if (uploadUrl === undefined && location !== undefined && bucketName !== undefined && region !== undefined) {
    uploadUrl = new URL(`https://${bucketName}.cos.${region}.myqcloud.com/${location.replace(/^\/+/, '')}`);
  }
  if (uploadUrl === undefined) cosError('上传凭证缺少目标地址字段，需要按真实响应核对上传流程。');
  if (uploadUrl.protocol !== 'https:' && uploadUrl.protocol !== 'http:') cosError('上传地址协议无效。');
  requireHost(uploadUrl);

  return {
    uploadUrl,
    resourceUrl: resourceUrl ?? uploadUrl.toString(),
    secretId,
    secretKey,
    sessionToken,
    contentType,
  };
}

/** COS XML API 的 putObject 签名（HMAC-SHA1，对 content-type 与 host 签名）。 */
export function buildCosAuthorization(info: CosUploadInfo, nowMs = Date.now()): string {
  const startSecond = Math.floor(nowMs / 1000);
  const keyTime = `${startSecond};${startSecond + 900}`;
  const signKey = createHmac('sha1', info.secretKey).update(keyTime).digest('hex');
  const headerList = 'content-type;host';
  const headerString = `content-type=${encodeURIComponent(info.contentType)}&host=${encodeURIComponent(info.uploadUrl.host.toLowerCase())}`;
  const httpString = `put\n${decodeURIComponent(info.uploadUrl.pathname)}\n\n${headerString}\n`;
  const httpStringHash = createHash('sha1').update(httpString).digest('hex');
  const stringToSign = `sha1\n${keyTime}\n${httpStringHash}\n`;
  const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${info.secretId}&q-sign-time=${keyTime}` +
    `&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

export function cosUploadHeaders(info: CosUploadInfo, nowMs = Date.now()): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: buildCosAuthorization(info, nowMs),
    'Content-Type': info.contentType,
  };
  if (info.sessionToken !== undefined) headers['x-cos-security-token'] = info.sessionToken;
  return headers;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function uploadFileNameFor(image: Pick<HunyuanGenerationInput['image'], 'mime'>): string {
  const extension = EXTENSION_BY_MIME[image.mime] ?? 'bin';
  return `hunyuan-input-${randomUUID()}.${extension}`;
}
