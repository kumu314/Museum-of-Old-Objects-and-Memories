import { z } from 'zod';
import { Hunyuan3DError } from './errors';
import { HttpError } from '../../http';
import type { Hunyuan3DConfig } from './types';

const cloudSchema = z.strictObject({
  secretId: z.string().trim().min(1).max(200).regex(/^[^\s]+$/),
  secretKey: z.string().trim().min(1).max(400).regex(/^[^\s]+$/),
  region: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/),
  model: z.enum(['3.0', '3.1']).optional(),
});

export type HunyuanCloudConfiguration = {
  config: Hunyuan3DConfig;
  provider: 'hunyuan-cloud';
};

/**
 * 官方云 API（混元生 3D 专业版）配置。三项必需变量齐全才启用；完全未配置
 * 返回 undefined，让编排退回本机反代演示链路。部分配置视为错误，避免静默
 * 落到另一条通道却以为在用云 API。
 */
export function readHunyuanCloudConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): HunyuanCloudConfiguration | undefined {
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
  const insecureResult = environment.HUNYUAN_CLOUD_ALLOW_INSECURE_RESULT === '1';
  if ((overrideEndpoint || insecureResult) && environment.NODE_ENV !== 'test') {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '云 API 地址覆盖与不安全来源开关仅允许测试环境使用。' });
  }
  const loopbackOnly = (url: URL): void => {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !['127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Hunyuan3DError('RESULT_URL_REJECTED', '测试生成来源仅允许环回地址。');
    }
  };
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
