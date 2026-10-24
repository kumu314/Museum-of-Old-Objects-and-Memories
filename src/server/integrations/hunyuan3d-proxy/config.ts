import { z } from 'zod';
import { HttpError } from '../../http';
import type { HunyuanProxyConfig } from './types';

const proxyConfigSchema = z.strictObject({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }),
});

/**
 * 演示链路只依赖本机反代地址；SecretId/SecretKey 生产配置由官方云 API
 * 适配器使用，编排接入时再扩展双 provider。缺失时受控失败，绝不返回
 * 演示数据。
 */
export function readHunyuanProxyConfig(environment: Readonly<Record<string, string | undefined>> = process.env): HunyuanProxyConfig {
  const baseUrl = environment.HUNYUAN_PROXY_BASE_URL?.trim();
  if (!baseUrl) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '三维生成服务尚未配置，请先启动并配置本机混元反代。' });
  }
  const parsed = proxyConfigSchema.safeParse({ baseUrl });
  if (!parsed.success) {
    throw new HttpError({ code: 'GENERATION_UNAVAILABLE', message: '三维生成服务配置无效，请检查反代地址。' });
  }
  const config: HunyuanProxyConfig = { baseUrl: parsed.data.baseUrl };
  // 仅限本地假上游测试：显式开启后允许 http 上传与下载地址；生产环境不得
  // 设置，默认策略仍要求腾讯 COS 的 HTTPS 上传与下载来源。
  if (environment.HUNYUAN_PROXY_ALLOW_INSECURE_UPLOAD === '1') {
    config.cosHostPolicy = () => {};
    config.resultUrlPolicy = () => {};
  }
  return config;
}
