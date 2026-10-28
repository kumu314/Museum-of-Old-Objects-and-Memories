/**
 * 单段 `Range` 解析。只支持 `bytes=start-end`、`bytes=start-`、`bytes=-suffix` 三种形态。
 *
 * 多段范围需要 `multipart/byteranges` 响应，首版不实现：按 RFC 9110 允许忽略该头并返回
 * 200 完整内容，而不是回 416 让播放器误判文件不可读。
 */
export type ByteRange = { start: number; end: number };
export type RangeResult = { kind: 'none' } | { kind: 'range'; range: ByteRange } | { kind: 'unsatisfiable' };

const singleRange = /^bytes=(\d*)-(\d*)$/;

function safeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseByteRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: 'none' };
  const match = singleRange.exec(header.trim());
  if (!match) return { kind: 'none' };
  const [, startText, endText] = match;
  if (startText === undefined || endText === undefined) return { kind: 'none' };
  // `bytes=-` 两端都空是无效语法，忽略即可；真正需要报 416 的是范围落在文件外。
  if (startText === '' && endText === '') return { kind: 'none' };
  if (size === 0) return { kind: 'unsatisfiable' };

  if (startText === '') {
    // 后缀范围：取末尾 N 字节。N=0 没有可返回的内容。
    const suffix = safeInteger(endText);
    if (suffix === null || suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', range: { start: Math.max(0, size - suffix), end: size - 1 } };
  }

  const start = safeInteger(startText);
  if (start === null || start >= size) return { kind: 'unsatisfiable' };
  if (endText === '') return { kind: 'range', range: { start, end: size - 1 } };
  const declaredEnd = safeInteger(endText);
  if (declaredEnd === null || declaredEnd < start) return { kind: 'unsatisfiable' };
  // 客户端常把 end 写得比文件大，按 RFC 截到最后一个字节。
  return { kind: 'range', range: { start, end: Math.min(declaredEnd, size - 1) } };
}
