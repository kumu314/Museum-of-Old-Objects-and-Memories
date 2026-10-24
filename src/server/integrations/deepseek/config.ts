import { z } from 'zod';
import { HttpError } from '../../http';

const configSchema = z.strictObject({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && ['', '/', '/v1', '/v1/'].includes(url.pathname);
  }),
  model: z.enum(['deepseek-flash', 'deepseek-v4-pro']),
  apiKey: z.string().min(1).max(4_096).regex(/^[^\s]+$/u),
});

// No fallback to AI_* credentials, a different model, or a demo completion.
export function readDeepSeekConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const parsed = configSchema.safeParse({ baseUrl: environment.DEEPSEEK_BASE_URL,
    model: environment.DEEPSEEK_MODEL, apiKey: environment.DEEPSEEK_API_KEY });
  if (!parsed.success) throw new HttpError({ code: 'AI_UNAVAILABLE', message: '自传 AI 尚未配置或配置无效，仍可保存、人工编辑及导出已有资料。' });
  const endpoint = new URL(parsed.data.baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, '')}/chat/completions`;
  return { endpoint: endpoint.href, model: parsed.data.model, apiKey: parsed.data.apiKey };
}
