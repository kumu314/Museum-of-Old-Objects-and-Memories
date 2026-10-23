import { z } from 'zod';
import { errorResponseSchema, successResponseSchema, type ApiError } from '../../contracts/errors';

export class ApiFailure extends Error {
  constructor(readonly failure: ApiError) { super(failure.message); }
}

export async function apiRequest<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = errorResponseSchema.safeParse(body);
    if (failure.success) throw new ApiFailure(failure.data.error);
    throw new Error('服务返回异常，请保留输入后重试。');
  }
  return successResponseSchema(schema).parse(body).data;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.failure.code === 'VERSION_CONFLICT') return '内容已在另一处更新。你的输入仍保留，请先复制需要保留的内容，再点击“重新读取”核对最新版本。';
    return error.message;
  }
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；');
  return error instanceof Error ? error.message : '操作未完成，请保留输入后重试。';
}
