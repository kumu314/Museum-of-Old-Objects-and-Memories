import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { privateHeaders } from '../http';
import { parseByteRange } from './range';

/**
 * 私有素材/模型的统一文件响应。
 *
 * - 用 stat 取真实长度，不信任数据库里的 byte_size（文件可能被外部替换或截断）。
 * - 支持单段 Range：音频拖动进度、断点续传、分段加载都依赖 206。
 * - 用文件流而不是 readFile：60 MB 的生成模型不应整份进内存。
 * - 调用方必须先完成身份、归属、分享快照与素材授权检查，再把落盘路径交给这里。
 */
export async function privateFileResponse(options: {
  request: Request;
  path: string;
  contentType: string;
  /** 文件不存在时抛出调用方的「不可访问」错误：不得区分「不存在」与「无权限」。 */
  onMissing: () => never;
}): Promise<Response> {
  const { request, path, contentType, onMissing } = options;
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) onMissing();
    size = info.size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') onMissing();
    throw error;
  }

  const parsed = parseByteRange(request.headers.get('range'), size);
  if (parsed.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: {
      ...privateHeaders,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${size}`,
    } });
  }

  const range = parsed.kind === 'range' ? parsed.range : null;
  const length = range === null ? size : range.end - range.start + 1;
  const headers: Record<string, string> = {
    ...privateHeaders,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(length),
    ...(range === null ? {} : { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }),
  };
  const stream = range === null
    ? createReadStream(path)
    : createReadStream(path, { start: range.start, end: range.end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range === null ? 200 : 206,
    headers,
  });
}
