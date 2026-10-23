import { createHash } from "node:crypto";
import sharp from "sharp";
import { AssetError } from "./errors.js";
import {
  IMAGE_MAX_AXIS_PX,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  type AssetInput,
  type ImageFormat,
  type ImageProcessResult,
  type ImageVariant,
  type ImageVariantKind,
} from "./types.js";

const MIME_TO_FORMAT = new Map<string, ImageFormat>([
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/png", "png"],
  ["image/x-png", "png"],
  ["image/webp", "webp"],
  ["image/x-webp", "webp"],
]);

const IMAGE_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type ImageVariantSpec = {
  kind: ImageVariantKind;
  maxEdge: number;
  quality: number;
};

const VARIANT_SPECS: readonly ImageVariantSpec[] = [
  { kind: "display", maxEdge: 2048, quality: 82 },
  { kind: "texture", maxEdge: 2048, quality: 90 },
  { kind: "thumbnail", maxEdge: 480, quality: 78 },
];

const SHARP_INPUT_OPTIONS = {
  limitInputPixels: IMAGE_MAX_PIXELS,
  failOn: "error",
  sequentialRead: true,
} as const;

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

export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8 " || chunk === "VP8L" || chunk === "VP8X") {
      return "webp";
    }
  }

  return null;
}

function assertDeclaredMime(declared: string | undefined, actual: ImageFormat): void {
  const normalized = normalizeMime(declared);
  if (normalized === undefined || normalized === "application/octet-stream") {
    return;
  }

  const declaredFormat = MIME_TO_FORMAT.get(normalized);
  if (declaredFormat === undefined) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持静态 JPEG、PNG、WebP 图片");
  }
  if (declaredFormat !== actual) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "文件内容与声明的图片类型不一致");
  }
}

function hasApngAnimation(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes);
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    if (chunkLength > buffer.length - offset - 12) {
      return false;
    }
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "acTL") {
      return true;
    }
    if (chunkType === "IDAT" || chunkType === "IEND") {
      return false;
    }
    offset += 12 + chunkLength;
  }
  return false;
}

function hasWebpAnimation(bytes: Uint8Array): boolean {
  if (bytes.length < 21 || ascii(bytes, 12, 16) !== "VP8X") {
    return false;
  }
  const flags = bytes[20];
  return flags !== undefined && (flags & 0x02) !== 0;
}

function assertImageDimensions(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new AssetError("VALIDATION_ERROR", "图片尺寸无效");
  }
  if (width > IMAGE_MAX_AXIS_PX || height > IMAGE_MAX_AXIS_PX) {
    throw new AssetError(
      "VALIDATION_ERROR",
      `图片宽高不能超过 ${IMAGE_MAX_AXIS_PX} 像素`,
    );
  }
  if (width * height > IMAGE_MAX_PIXELS) {
    throw new AssetError(
      "VALIDATION_ERROR",
      `图片总像素不能超过 ${IMAGE_MAX_PIXELS.toLocaleString("en-US")}`,
    );
  }
}

function toAssetError(error: unknown): AssetError {
  if (error instanceof AssetError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "";
  if (/pixel limit|exceeds pixel|pixel.*exceed/i.test(message)) {
    return new AssetError("VALIDATION_ERROR", `图片总像素不能超过 ${IMAGE_MAX_PIXELS.toLocaleString("en-US")}`, {
      cause: error,
    });
  }
  if (/unsupported image format|unsupported.*format/i.test(message)) {
    return new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持静态 JPEG、PNG、WebP 图片", {
      cause: error,
    });
  }
  return new AssetError("VALIDATION_ERROR", "图片无法解析或已损坏", { cause: error });
}

async function renderVariant(
  input: Buffer,
  spec: ImageVariantSpec,
): Promise<ImageVariant> {
  const { data, info } = await sharp(input, SHARP_INPUT_OPTIONS)
    .rotate()
    .toColourspace("srgb")
    .resize({
      width: spec.maxEdge,
      height: spec.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: spec.quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    kind: spec.kind,
    bytes: new Uint8Array(data),
    mimeType: "image/webp",
    width: info.width,
    height: info.height,
    byteLength: data.byteLength,
    sha256: sha256(data),
  };
}

export async function validateAndProcessImage(input: AssetInput): Promise<ImageProcessResult> {
  if (input.bytes.byteLength === 0) {
    throw new AssetError("VALIDATION_ERROR", "图片文件为空");
  }
  if (input.bytes.byteLength > IMAGE_MAX_BYTES) {
    throw new AssetError(
      "PAYLOAD_TOO_LARGE",
      `图片不能超过 ${IMAGE_MAX_BYTES.toLocaleString("en-US")} 字节`,
    );
  }

  const format = detectImageFormat(input.bytes);
  if (format === null) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "仅支持静态 JPEG、PNG、WebP 图片");
  }
  assertDeclaredMime(input.declaredMimeType, format);

  if (format === "png" && hasApngAnimation(input.bytes)) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "不支持动态图片");
  }
  if (format === "webp" && hasWebpAnimation(input.bytes)) {
    throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "不支持动态图片");
  }

  const buffer = Buffer.from(input.bytes);

  try {
    const metadata = await sharp(buffer, SHARP_INPUT_OPTIONS).metadata();
    if (metadata.format !== format) {
      throw new AssetError("VALIDATION_ERROR", "图片实际格式与文件签名不一致");
    }
    if (metadata.pages !== undefined && metadata.pages > 1) {
      throw new AssetError("UNSUPPORTED_MEDIA_TYPE", "不支持动态图片");
    }
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new AssetError("VALIDATION_ERROR", "无法读取图片尺寸");
    }
    assertImageDimensions(metadata.width, metadata.height);

    const swapsAxes =
      metadata.orientation !== undefined &&
      metadata.orientation >= 5 &&
      metadata.orientation <= 8;
    const sourceWidth = swapsAxes ? metadata.height : metadata.width;
    const sourceHeight = swapsAxes ? metadata.width : metadata.height;

    // Decode once to prove the whole file is readable. Variants are rendered
    // from the original so a lossy intermediate never feeds the texture.
    await sharp(buffer, SHARP_INPUT_OPTIONS)
      .rotate()
      .toColourspace("srgb")
      .toBuffer();

    const variants: ImageVariant[] = [];
    for (const spec of VARIANT_SPECS) {
      variants.push(await renderVariant(buffer, spec));
    }

    const display = variants[0];
    if (display === undefined) {
      throw new AssetError("VALIDATION_ERROR", "图片处理未生成展示版本");
    }

    return {
      kind: "image",
      sourceFormat: format,
      sourceWidth,
      sourceHeight,
      width: display.width,
      height: display.height,
      variants,
    };
  } catch (error) {
    throw toAssetError(error);
  }
}

export function imageMimeType(format: ImageFormat): string {
  return IMAGE_MIME[format];
}
