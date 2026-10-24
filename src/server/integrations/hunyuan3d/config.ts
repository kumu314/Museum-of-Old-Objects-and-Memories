import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Hunyuan3DError } from './errors';
import { HttpError } from '../../http';
import type { Hunyuan3DConfig } from './types';

const cloudSchema = z.strictObject({
  secretId: z.string().trim().min(1).max(200).regex(/^[^\s]+$/),
  secretKey: z.string().trim().min(1).max(400).regex(/^[^\s]+$/),
  region: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
  model: z.enum(['3.0', '3.1']).optional(),
  /** 可替换的 API 地址；https 任意主机，http 仅本机测试。 */
  endpoint: z.url().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

/**
 * 服务端可热替换的通道配置，放在 .local/model-provider.json（Git 已忽略）。
 * 改完下一次请求即生效，不需要重启或改代码：
 *
 * {
 *   "provider": "hunyuan-cloud" | "hunyuan-proxy",
 *   "cloud": { "secretId": "...", "secretKey": "...", "region": "ap-guangzhou",
 *              "endpoint": "https://...", "model": "3.1", "timeoutMs": 60000 },
 *   "proxyBaseUrl": "http://127.0.0.1:8812"
 * }
 *
 * 额度用完后，把这里的 secretId/secretKey（或 endpoint）换成新 API 即可。
 * 凭据只存在于服务端文件，不通过 API 返回、不写日志、不提交仓库。
 */
const settingsSchema = z.strictObject({
  provider: z.enum(['hunyuan-cloud', 'hunyuan-proxy']).optional(),
  cloud: cloudSchema.optional(),
  proxyBaseUrl: z.url().optional(),
});
export type ModelProviderSettings = z.infer<typeof settingsSchema>;

const cacheTtlMs = 1_000;
let settingsCache: { path: string; mtimeMs: number; loadedAt: number; value: ModelProviderSettings | null } | undefined;

/** 读取替换配置；文件不存在返回 null。语法/字段错误按受控失败处理。 */
export function readProviderSettings(path = resolve('.local', 'model-provider.json')): ModelProviderSettings | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    settingsCache = { path, mtimeMs: 0, loadedAt: Date.now(), value: null };
    return null;
  }
  const now = Date.now();
  if (settingsCache?.path === path && settingsCache.mtimeMs === mtimeMs && now - settingsCache.loadedAt < cacheTtlMs) {
    return settingsCache.value;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '通道配置文件不是合法 JSON，请检查 .local/model-provider.json。' });
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '通道配置文件字段无效，请检查密钥、地域与 API 地址。' });
  }
  settingsCache = { path, mtimeMs, loadedAt: now, value: parsed.data };
  return parsed.data;
}

export type HunyuanCloudConfiguration = {
  config: Hunyuan3DConfig;
  provider: 'hunyuan-cloud';
};

function loopbackOnly(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Hunyuan3DError('RESULT_URL_REJECTED', '测试生成来源仅允许环回地址。');
  }
}

function assertReplaceableEndpoint(value: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' ||
    url.search !== '' || url.hash !== '') {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: 'API 地址无效：必须是不携带凭据与查询串的 HTTP(S) 地址。' });
  }
  if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: 'API 地址必须使用 HTTPS（本机测试地址除外）。' });
  }
}

/**
 * 官方云 API 配置。优先使用 .local/model-provider.json（可热替换 API 地址与
 * 凭据），否则读环境变量。三项必需值齐全才启用；完全未配置返回 undefined。
 */
export function readHunyuanCloudConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  settingsPath?: string,
): HunyuanCloudConfiguration | undefined {
  const settings = settingsPath === undefined ? readProviderSettings() : readProviderSettings(settingsPath);
  const insecureResult = environment.HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT === '1';
  if (settings?.cloud !== undefined) {
    const config: Hunyuan3DConfig = {
      secretId: settings.cloud.secretId,
      secretKey: settings.cloud.secretKey,
      region: settings.cloud.region,
      timeoutMs: settings.cloud.timeoutMs ?? 60_000,
    };
    if (settings.cloud.model !== undefined) config.model = settings.cloud.model;
    if (settings.cloud.endpoint !== undefined) {
      assertReplaceableEndpoint(settings.cloud.endpoint);
      config.endpoint = settings.cloud.endpoint;
    }
    if (insecureResult) config.resultUrlPolicy = loopbackOnly;
    return { config, provider: 'hunyuan-cloud' };
  }

  const values = {
    secretId: environment.HUNYUAN_SECRET_ID,
    secretKey: environment.HUNYUAN_SECRET_KEY,
    region: environment.HUNYUAN_REGION,
    model: environment.HUNYUAN_3D_MODEL,
  };
  const present = [values.secretId, values.secretKey, values.region].filter((value) => value !== undefined && value.trim() !== '');
  if (present.length === 0) return undefined;
  if (present.length < 3) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '云 API 配置不完整：需要同时设置 HUNYUAN_SECRET_ID、HUNYUAN_SECRET_KEY 与 HUNYUAN_REGION。' });
  }
  const parsed = cloudSchema.safeParse(values);
  if (!parsed.success) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '云 API 配置无效，请检查密钥与地域格式。' });
  }
  const config: Hunyuan3DConfig = {
    secretId: parsed.data.secretId,
    secretKey: parsed.data.secretKey,
    region: parsed.data.region,
    timeoutMs: 60_000,
  };
  if (parsed.data.model !== undefined) config.model = parsed.data.model;
  const endpoint = environment.HUNYUAN_3D_ENDPOINT?.trim();
  const overrideEndpoint = endpoint !== undefined && endpoint !== '';
  if ((overrideEndpoint || insecureResult) && environment.NODE_ENV !== 'test') {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '环境变量形式的地址覆盖与不安全来源开关仅允许测试环境使用；生产请用 .local/model-provider.json。' });
  }
  if (overrideEndpoint) {
    try {
      loopbackOnly(new URL(endpoint));
    } catch {
      throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '云 API 测试地址必须为不携带凭据的 HTTP(S) 环回地址。' });
    }
    config.endpoint = endpoint;
  }
  if (insecureResult) config.resultUrlPolicy = loopbackOnly;
  return { config, provider: 'hunyuan-cloud' };
}

/** 通道锁定：配置文件优先，其次环境变量；都未指定时按可用性自动选择。 */
export function readForcedProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  settingsPath?: string,
): 'hunyuan-cloud' | 'hunyuan-proxy' | undefined {
  const settings = settingsPath === undefined ? readProviderSettings() : readProviderSettings(settingsPath);
  if (settings?.provider !== undefined) return settings.provider;
  const forced = environment.HUNYUAN_PROVIDER?.trim();
  if (forced === 'proxy') return 'hunyuan-proxy';
  if (forced === 'cloud') return 'hunyuan-cloud';
  return undefined;
}

/** 配置文件里的反代地址（仅演示通道使用）。 */
export function readSettingsProxyBaseUrl(): string | undefined {
  return readProviderSettings()?.proxyBaseUrl;
}
