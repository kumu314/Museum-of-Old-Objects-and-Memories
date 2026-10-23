export const IMAGE_MAX_BYTES = 10_485_760;
export const IMAGE_MAX_AXIS_PX = 8_192;
export const IMAGE_MAX_PIXELS = 32_000_000;

export const AUDIO_MAX_BYTES = 20_971_520;

export type ImageFormat = "jpeg" | "png" | "webp";
export type AudioFormat = "mp3" | "m4a" | "wav";
export type ImageVariantKind = "display" | "thumbnail" | "texture";

export type ImageVariant = {
  kind: ImageVariantKind;
  bytes: Uint8Array;
  mimeType: "image/webp";
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
};

export type ImageProcessResult = {
  kind: "image";
  sourceFormat: ImageFormat;
  /** Oriented source dimensions before the display resize. */
  sourceWidth: number;
  sourceHeight: number;
  /** Display variant dimensions after EXIF orientation and resize. */
  width: number;
  height: number;
  variants: readonly ImageVariant[];
};

export type AudioProcessResult = {
  kind: "audio";
  format: AudioFormat;
  mimeType: "audio/mpeg" | "audio/mp4" | "audio/wav";
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
};

export type AssetInput = {
  bytes: Uint8Array;
  declaredMimeType?: string;
};
