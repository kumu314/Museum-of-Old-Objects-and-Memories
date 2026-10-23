import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { errorHttpStatus, errorResponseSchema, shareNotFoundMessage, type ApiError } from '../contracts/errors';

type Failure = ApiError extends infer Error ? Error extends ApiError ? Omit<Error, 'requestId'> : never : never;
export class HttpError extends Error {
  constructor(readonly failure: Failure) { super(failure.message); }
}
export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};
export function dataResponse<T>(data: T, status = 200) {
  return Response.json({ data }, { status, headers: privateHeaders });
}
export function errorResponse(error: unknown, requestId: string = randomUUID()) {
  let failure: Failure;
  if (error instanceof HttpError) failure = error.failure;
  else if (error instanceof ZodError || error instanceof SyntaxError) failure = { code: 'VALIDATION_ERROR', message: '请核对输入内容后重试。' };
  else {
    failure = { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' };
    // Never serialize database/provider errors: they can contain parameters or credentials.
    console.error(JSON.stringify({ requestId, category: 'unhandled-request-error', errorType: error instanceof Error ? error.name : 'unknown' }));
  }
  const body = errorResponseSchema.parse({ error: { ...failure, message: failure.code === 'SHARE_NOT_FOUND' ? shareNotFoundMessage : failure.message, requestId } });
  return Response.json(body, { status: errorHttpStatus[failure.code], headers: privateHeaders });
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用 JSON 请求。' });
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError({ code: 'VALIDATION_ERROR', message: '请求内容不能为空。' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new HttpError({ code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大。' });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
