import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Hunyuan3DError } from '../hunyuan3d/errors';
import type { HunyuanGenerationInput } from '../hunyuan3d/types';

/**
 * 输入照片上传：反代提供 genUploadInfo 透传，返回腾讯 COS 临时凭证与目标；
 * 本模块用这些凭证直接 PUT 到 COS，再把 resourceUrl 交给生成任务引用。
 *
 * 已按 2026-10-24 真实响应核对：resourceUrl 是混元站内的下载代理地址
 * （3d.hunyuan.tencent.com/api/3d/resource/download?resourceId=...），不是
 * COS 直链；PUT 目标由 bucketName/region/location 推导。临时凭证字段为
 * encryptTmpSecretId / encryptTmpSecretKey / encryptToken。
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
  const sessionToken = firstString(data, ['sessionToken', 'encryptToken', 'tmpSessionToken', 'Token']);
  const resourceUrl = firstString(data, ['resourceUrl', 'url']);
  const location = firstString(data, ['location', 'key']);
  const bucketName = firstString(data, ['bucketName', 'bucket']);
  const region = firstString(data, ['region']);

  if (secretId === undefined || secretKey === undefined) {
    cosError('上传凭证缺少临时密钥字段，需要按真实响应核对上传流程。');
  }

  // PUT 目标优先由 bucket/region/location 推导（真实响应的 resourceUrl 是
  // 站内下载地址，不能当上传目标）；仅当缺失时退回 resourceUrl（旧形状）。
  let uploadUrl: URL | undefined;
  if (bucketName !== undefined && region !== undefined && location !== undefined) {
    uploadUrl = new URL(`https://${bucketName}.cos.${region}.myqcloud.com/${location.replace(/^\/+/, '')}`);
  } else if (resourceUrl !== undefined) {
    try {
      const parsed = new URL(resourceUrl);
      if (parsed.pathname !== '/') uploadUrl = parsed;
    } catch {
      uploadUrl = undefined;
    }
  }
  if (uploadUrl === undefined) cosError('上传凭证缺少目标地址字段，需要按真实响应核对上传流程。');
  if (uploadUrl.protocol !== 'https:' && uploadUrl.protocol !== 'http:') cosError('上传地址协议无效。');
  requireHost(uploadUrl);
  if (resourceUrl === undefined) cosError('上传凭证缺少 resourceUrl，生成任务无法引用已上传的图片。');

  return {
    uploadUrl,
    resourceUrl,
    secretId,
    secretKey,
    sessionToken,
    contentType,
  };
}

/** COS XML API 的 putObject 签名（HMAC-SHA1）。使用临时凭证时
 * x-cos-security-token 必须随请求发送并参与签名计算。 */
export function buildCosAuthorization(info: CosUploadInfo, nowMs = Date.now()): string {
  const startSecond = Math.floor(nowMs / 1000);
  const keyTime = `${startSecond};${startSecond + 900}`;
  const signKey = createHmac('sha1', info.secretKey).update(keyTime).digest('hex');
  const tokenSuffix = info.sessionToken !== undefined ? ';x-cos-security-token' : '';
  const headerList = `content-type;host${tokenSuffix}`;
  const headerString = `content-type=${encodeURIComponent(info.contentType)}&host=${encodeURIComponent(info.uploadUrl.host.toLowerCase())}` +
    (info.sessionToken !== undefined ? `&x-cos-security-token=${encodeURIComponent(info.sessionToken)}` : '');
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
