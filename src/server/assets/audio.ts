import { createHash } from "node:crypto";
import { parseBuffer } from "music-metadata";
import { AssetError } from "./errors";
import {
  AUDIO_MAX_BYTES,
  type AssetInput,
  type AudioFormat,
  type AudioProcessResult,
} from "./types";

const MIME_TO_FORMAT = new Map<string, AudioFormat>([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/x-mp3", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/wave", "wav"],
]);

const MIME_BY_FORMAT: Record<AudioFormat, AudioProcessResult["mimeType"]> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

const M4A_BRANDS = new Set([
  "M4A ",
  "M4B ",
  "M4P ",
  "mp41",
  "mp42",
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeMime(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const base = value.split(";")[0];
  if (base === undefined) {
    return undefined;
  }
  const normalized = base.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return Buffer.from(bytes.subarray(start, end)).toString("ascii");
}

export function detectAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.length >= 4 && ascii(bytes, 0, 3) === "ID3") {
    return "mp3";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0) {
    // Covers MPEG audio and ADTS; music-metadata decides which container it is.
    return "mp3";
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    return M4A_BRANDS.has(brand) ? "m4a" : null;
  }

  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    return "wav";
  }

  return null;
}

function assertDeclaredMime(declared: string | undefined, actual: AudioFormat): void {
  const normalized = normalizeMime(declared);
  if (normalized === undefined || normalized === "application/octet-stream") {
    return;
  }

  const declaredFormat = MIME_TO_FORMAT.get(normalized);
  if (declaredFormat === undefined) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持 MP3、M4A（AAC）和 WAV（PCM）音频");
  }
  if (declaredFormat !== actual) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "文件内容与声明的音频类型不一致");
  }
}

function assertWavStructure(buffer: Buffer): void {
  let offset = 12;
  let hasFmt = false;
  let hasData = false;
  let chunks = 0;

  while (offset + 8 <= buffer.length) {
    chunks += 1;
    if (chunks > 1_000) {
      throw new AssetError("VALIDATION_ERROR", "WAV 分块数量异常");
    }

    const chunkId = buffer.toString("ascii", offset, offset + 4);
    if (chunkId === "\u0000\u0000\u0000\u0000") {
      break;
    }

    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkSize > buffer.length - dataStart) {
      throw new AssetError("VALIDATION_ERROR", "WAV 数据不完整");
    }
    if (chunkId === "fmt ") {
      hasFmt = true;
    }
    if (chunkId === "data") {
      if (chunkSize === 0) {
        throw new AssetError("VALIDATION_ERROR", "WAV 没有音频数据");
      }
      hasData = true;
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (!hasFmt || !hasData) {
    throw new AssetError("VALIDATION_ERROR", "WAV 缺少格式或音频数据块");
  }
}

function assertM4aStructure(buffer: Buffer): void {
  let offset = 0;
  let hasMoov = false;
  let hasMdat = false;
  let boxes = 0;

  while (offset + 8 <= buffer.length) {
    boxes += 1;
    if (boxes > 1_000) {
      throw new AssetError("VALIDATION_ERROR", "M4A 分块数量异常");
    }

    let boxSize = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (boxSize === 1) {
      if (offset + 16 > buffer.length) {
        throw new AssetError("VALIDATION_ERROR", "M4A 数据不完整");
      }
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(buffer.length)) {
        throw new AssetError("VALIDATION_ERROR", "M4A 数据不完整");
      }
      boxSize = Number(largeSize);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = buffer.length - offset;
    }

    if (boxSize < headerSize || offset + boxSize > buffer.length) {
      throw new AssetError("VALIDATION_ERROR", "M4A 数据不完整");
    }

    if (boxType === "moov") {
      hasMoov = true;
    }
    if (boxType === "mdat") {
      hasMdat = true;
    }

    offset += boxSize;
  }

  if (!hasMoov || !hasMdat) {
    throw new AssetError("VALIDATION_ERROR", "M4A 缺少元数据或音频数据块");
  }
}

function assertAudioFormat(
  format: AudioFormat,
  metadata: Awaited<ReturnType<typeof parseBuffer>>,
): void {
  const container = metadata.format.container ?? "";
  const codec = metadata.format.codec ?? "";
  const hasVideo = metadata.format.hasVideo === true;
  const hasAudio = metadata.format.hasAudio === true;

  if (!hasAudio) {
    throw new AssetError("VALIDATION_ERROR", "音频文件没有可读取的音轨");
  }
  if (hasVideo) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "M4A 不包含视频轨，请上传纯音频文件");
  }

  if (format === "mp3") {
    if (container !== "MPEG") {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持 MP3 音频");
    }
    if (codec.length === 0) {
      throw new AssetError("VALIDATION_ERROR", "无法确认 MP3 音频编码");
    }
    if (!/^MPEG (1|2|2\.5) Layer 3$/.test(codec)) {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持 MPEG Layer III（MP3）音频");
    }
  } else if (format === "m4a") {
    if (codec.length === 0) {
      throw new AssetError("VALIDATION_ERROR", "无法确认 M4A 音频编码");
    }
    if (!/AAC/i.test(codec)) {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "M4A 仅允许 AAC 编码");
    }
  } else {
    if (container !== "WAVE") {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持 WAV 音频");
    }
    if (codec.length === 0) {
      throw new AssetError("VALIDATION_ERROR", "无法确认 WAV 音频编码");
    }
    if (codec !== "PCM") {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "WAV 仅允许 PCM 编码");
    }
  }

  if (metadata.format.sampleRate === undefined || metadata.format.sampleRate <= 0) {
    throw new AssetError("VALIDATION_ERROR", "音频采样率无效");
  }
  if (metadata.format.numberOfChannels === undefined || metadata.format.numberOfChannels <= 0) {
    throw new AssetError("VALIDATION_ERROR", "音频声道数无效");
  }
  if (metadata.format.duration === undefined || metadata.format.duration <= 0) {
    throw new AssetError("VALIDATION_ERROR", "音频没有可播放内容");
  }
}

export async function validateAudio(input: AssetInput): Promise<AudioProcessResult> {
  if (input.bytes.byteLength === 0) {
    throw new AssetError("VALIDATION_ERROR", "音频文件为空");
  }
  if (input.bytes.byteLength > AUDIO_MAX_BYTES) {
    throw new AssetError(
      "PAYLOAD_TOO_LARGE",
      `音频不能超过 ${AUDIO_MAX_BYTES.toLocaleString("en-US")} 字节`,
    );
  }

  const format = detectAudioFormat(input.bytes);
  if (format === null) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持 MP3、M4A（AAC）和 WAV（PCM）音频");
  }
  assertDeclaredMime(input.declaredMimeType, format);

  const mimeType = MIME_BY_FORMAT[format];
  const buffer = Buffer.from(input.bytes);

  if (format === "wav") {
    assertWavStructure(buffer);
  } else if (format === "m4a") {
    assertM4aStructure(buffer);
  }

  let metadata: Awaited<ReturnType<typeof parseBuffer>>;
  try {
    metadata = await parseBuffer(
      buffer,
      { mimeType, size: buffer.byteLength },
      { duration: false },
    );
  } catch (error) {
    throw new AssetError("VALIDATION_ERROR", "音频无法解析或已损坏", { cause: error });
  }

  assertAudioFormat(format, metadata);

  return {
    kind: "audio",
    format,
    mimeType,
    bytes: new Uint8Array(input.bytes),
    byteLength: input.bytes.byteLength,
    sha256: sha256(input.bytes),
  };
}
