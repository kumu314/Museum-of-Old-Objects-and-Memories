import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { z } from 'zod';
import { uploadLimits } from '../../contracts/assets';
import { HttpError } from '../http';

const executeFile = promisify(execFile);
const formats = {
  jpeg: { kind: 'image', mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  png: { kind: 'image', mime: 'image/png', extensions: ['.png'] },
  webp: { kind: 'image', mime: 'image/webp', extensions: ['.webp'] },
  mp3: { kind: 'audio', mime: 'audio/mpeg', extensions: ['.mp3'] },
  m4a: { kind: 'audio', mime: 'audio/mp4', extensions: ['.m4a'] },
  wav: { kind: 'audio', mime: 'audio/wav', extensions: ['.wav'] },
} as const;
type Format = keyof typeof formats;
export interface AssetInput { inputBuffer: Buffer; originalName: string; mime: string }
interface ProcessedBase { bytes: Buffer; originalName: string; sha256: string }
export type ProcessedAsset =
  | ProcessedBase & { kind: 'image'; contentType: 'image/webp'; width: number; height: number; thumbnailBytes: Buffer }
  | ProcessedBase & { kind: 'audio'; contentType: 'audio/mpeg' | 'audio/mp4' | 'audio/wav' };

function invalid(message = '文件损坏或无法完整解析，请重新导出后上传。'): never {
  throw new HttpError({ code: 'VALIDATION_ERROR', message });
}
function unsupported(message = '仅支持静态 JPEG、PNG、WebP 图片及 MP3、M4A(AAC)、WAV(PCM) 音频。'): never {
  throw new HttpError({ code: 'UNSUPPORTED_MEDIA_TYPE', message });
}
function signature(buffer: Buffer): Format | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  const riff = buffer.toString('ascii', 0, 4) === 'RIFF';
  if (riff && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (riff && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buffer.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)) return 'mp3';
  return null;
}
function rejectAnimation(buffer: Buffer, format: 'png' | 'webp'): void {
  let position = format === 'png' ? 8 : 12;
  while (position + 8 <= buffer.length) {
    const length = format === 'png' ? buffer.readUInt32BE(position) : buffer.readUInt32LE(position + 4);
    const type = buffer.toString('ascii', position + (format === 'png' ? 4 : 0), position + (format === 'png' ? 8 : 4));
    if (['acTL', 'ANIM', 'ANMF'].includes(type)) unsupported('暂不支持动态图片，请上传静态图片。');
    position += format === 'png' ? length + 12 : length + 8 + (length % 2);
  }
}
async function processImage(bytes: Buffer, format: 'jpeg' | 'png' | 'webp'): Promise<Omit<Extract<ProcessedAsset, { kind: 'image' }>, 'originalName' | 'sha256'>> {
  if (format !== 'jpeg') rejectAnimation(bytes, format);
  try {
    const image = sharp(bytes, { limitInputPixels: uploadLimits.imagePixels, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== format) unsupported('文件实际格式与声明不一致。');
    if ((metadata.pages ?? 1) > 1) unsupported('暂不支持动态图片，请上传静态图片。');
    if (!metadata.width || !metadata.height || metadata.width > uploadLimits.imageDimension || metadata.height > uploadLimits.imageDimension || metadata.width * metadata.height > uploadLimits.imagePixels) invalid('图片单边不得超过 8192 像素，总像素不得超过 32000000。');
    // Sharp strips metadata by default. Do not call keepMetadata/withMetadata here.
    const oriented = await image.autoOrient().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    const thumbnailBytes = await sharp(oriented.data, { limitInputPixels: uploadLimits.imagePixels })
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    return { kind: 'image', contentType: 'image/webp', width: oriented.info.width, height: oriented.info.height, thumbnailBytes, bytes: oriented.data };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    invalid();
  }
}
const probeSchema = z.object({
  streams: z.array(z.object({ codec_name: z.string(), codec_type: z.string(),
    disposition: z.object({ attached_pic: z.number().optional() }).optional(),
  })).min(1),
  format: z.object({ format_name: z.string() }),
});
async function validateAudio(bytes: Buffer, format: 'mp3' | 'm4a' | 'wav'): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shiwuguan-audio-'));
  const path = join(directory, `input.${format}`);
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const { stdout } = await executeFile('ffprobe', ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=format_name:stream=codec_name,codec_type:stream_disposition=attached_pic', '-of', 'json', path], { timeout: 15_000, maxBuffer: 1_048_576 });
    const parsed: unknown = JSON.parse(stdout);
    const probe = probeSchema.safeParse(parsed);
    if (!probe.success) invalid();
    const allowedContainer = { mp3: 'mp3', wav: 'wav', m4a: 'mov,mp4,m4a,3gp,3g2,mj2' };
    if (probe.data.format.format_name !== allowedContainer[format]) unsupported();
    if (!probe.data.streams.some((stream) => stream.codec_type === 'audio')) unsupported();
    for (const stream of probe.data.streams) {
      if (stream.codec_type === 'video' && stream.disposition?.attached_pic === 1 && ['mjpeg', 'png'].includes(stream.codec_name)) continue;
      const allowedCodec = format === 'mp3' ? stream.codec_name === 'mp3'
        : format === 'm4a' ? stream.codec_name === 'aac' : /^pcm_(?:u8|s16le|s24le|s32le|f32le|f64le)$/.test(stream.codec_name);
      if (stream.codec_type !== 'audio' || !allowedCodec) unsupported();
    }
    // Probe headers alone can accept truncated packets. Decode the complete stream too.
    await executeFile('ffmpeg', ['-v', 'error', '-xerror', '-err_detect', 'explode', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', path, '-map', '0:a', '-f', 'null', '-'], { timeout: 20_000, maxBuffer: 1_048_576 });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.error(JSON.stringify({ category: 'audio-tool-missing' }));
      throw new HttpError({ code: 'INTERNAL_ERROR', message: '音频处理依赖不可用，请稍后重试或联系管理员。' });
    }
    if (error instanceof Error && 'killed' in error && error.killed === true) {
      throw new HttpError({ code: 'INTERNAL_ERROR', message: '音频处理超时，请稍后重试或联系管理员。' });
    }
    invalid();
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function processAsset(input: AssetInput): Promise<ProcessedAsset> {
  const originalName = input.originalName.split(/[\\/]/).at(-1) ?? '';
  if (!originalName.trim() || originalName.length > 255 || /[\u0000-\u001f]/.test(originalName)) invalid('文件名无效。');
  const extension = extname(originalName).toLowerCase();
  const declaration = Object.values(formats).find((definition) => definition.extensions.some((value) => value === extension));
  if (!declaration) unsupported();
  const byteLimit = declaration.kind === 'image' ? uploadLimits.imageBytes : uploadLimits.audioBytes;
  if (input.inputBuffer.length > byteLimit) throw new HttpError({ code: 'PAYLOAD_TOO_LARGE', message: declaration.kind === 'image' ? '图片不能超过 10 MiB。' : '音频不能超过 20 MiB。' });
  if (input.inputBuffer.length === 0) invalid();
  const format = signature(input.inputBuffer);
  if (format === null) {
    const header = input.inputBuffer.toString('ascii', 0, 12);
    if (/^(GIF8|BM|OggS|fLaC|II|MM|RIFF)/.test(header)) unsupported();
    invalid();
  }
  const suppliedMime = input.mime.toLowerCase().trim();
  const mimeAliases: Readonly<Record<string, string>> = { 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg' };
  const canonicalMime = mimeAliases[suppliedMime] ?? suppliedMime;
  if (!formats[format].extensions.some((value) => value === extension) || canonicalMime !== formats[format].mime) unsupported('文件实际格式、扩展名与 Content-Type 必须一致。');
  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    const image = await processImage(input.inputBuffer, format);
    // The decoded bytes belong to the output, never to the uploaded original.
    const bytes = image.bytes;
    return { ...image, bytes, originalName, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await validateAudio(input.inputBuffer, format);
  return { kind: 'audio', contentType: formats[format].mime, originalName, bytes: input.inputBuffer,
    sha256: createHash('sha256').update(input.inputBuffer).digest('hex') };
}
