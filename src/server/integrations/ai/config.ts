import { z } from 'zod';
import { HttpError } from '../../http';

const aiConfigSchema = z.strictObject({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  }),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(4_096).regex(/^[^\r\n]+$/),
});

// AI is optional for the manual workflow; missing credentials never become a demo response.
export function readAiConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const values = {
    baseUrl: environment.AI_BASE_URL,
    model: environment.AI_MODEL,
    apiKey: environment.AI_API_KEY,
  };
  if (!values.baseUrl || !values.model || !values.apiKey) {
    throw new HttpError({ code: 'AI_UNAVAILABLE', message: 'AI 服务尚未配置，可以继续人工编辑展签。' });
  }
  const parsed = aiConfigSchema.safeParse(values);
  if (!parsed.success) {
    throw new HttpError({ code: 'AI_UNAVAILABLE', message: 'AI 服务配置无效，请检查服务地址、模型和凭据。' });
  }
  const endpoint = new URL(parsed.data.baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/chat/completions`;
  return { endpoint: endpoint.href, model: parsed.data.model, apiKey: parsed.data.apiKey };
}
