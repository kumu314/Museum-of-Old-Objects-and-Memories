import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  IMAGE_MAX_BYTES,
  validateAndProcessImage,
  type ImageProcessResult,
  type ImageVariantKind,
} from "../index.js";

const TINY_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/image/${name}`, import.meta.url));
}

function asBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer);
}

function variantOf(result: ImageProcessResult, kind: ImageVariantKind) {
  const variant = result.variants.find((item) => item.kind === kind);
  if (variant === undefined) {
    throw new Error(`没有生成 ${kind} 版本`);
  }
  return variant;
}

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 90, b: 150 },
    },
  })
    .png()
    .toBuffer();
}

function padTo(buffer: Buffer, size: number): Buffer {
  const padded = Buffer.alloc(size);
  buffer.copy(padded);
  return padded;
}

describe("image validation and processing", () => {
  it("accepts a JPEG and produces display, texture, and thumbnail variants", async () => {
    const input = await solidJpeg(1200, 800);
    const result = await validateAndProcessImage({ bytes: asBytes(input) });

    expect(result.kind).toBe("image");
    expect(result.sourceFormat).toBe("jpeg");
    expect(result.sourceWidth).toBe(1200);
    expect(result.sourceHeight).toBe(800);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(800);
    expect(result.variants.map((item) => item.kind)).toEqual([
      "display",
      "texture",
      "thumbnail",
    ]);

    const display = variantOf(result, "display");
    const thumbnail = variantOf(result, "thumbnail");
    expect(display.width).toBe(1200);
    expect(display.height).toBe(800);
    expect(thumbnail.width).toBe(480);
    expect(thumbnail.height).toBe(320);

    for (const variant of result.variants) {
      expect(variant.mimeType).toBe("image/webp");
      expect(variant.byteLength).toBe(variant.bytes.byteLength);
      expect(variant.sha256).toMatch(/^[0-9a-f]{64}$/);

      const metadata = await sharp(Buffer.from(variant.bytes)).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it("accepts static PNG and WebP inputs", async () => {
    const png = await solidPng(300, 200);
    const pngResult = await validateAndProcessImage({ bytes: asBytes(png) });
    expect(pngResult.sourceFormat).toBe("png");

    const webp = await sharp({
      create: {
        width: 200,
        height: 300,
        channels: 3,
        background: { r: 10, g: 120, b: 80 },
      },
    })
      .webp()
      .toBuffer();
    const webpResult = await validateAndProcessImage({ bytes: asBytes(webp) });
    expect(webpResult.sourceFormat).toBe("webp");
  });

  it("preserves alpha in generated WebP variants", async () => {
    const png = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 200, g: 20, b: 20, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await validateAndProcessImage({ bytes: asBytes(png) });
    const metadata = await sharp(Buffer.from(variantOf(result, "display").bytes)).metadata();
    expect(metadata.hasAlpha).toBe(true);
  });

  it("does not upscale a small image", async () => {
    const input = await solidJpeg(10, 10);
    const result = await validateAndProcessImage({ bytes: asBytes(input) });
    expect(variantOf(result, "display").width).toBe(10);
    expect(variantOf(result, "thumbnail").width).toBe(10);
  });

  it("rejects a declared MIME type that does not match the bytes", async () => {
    const png = await solidPng(20, 20);
    await expect(
      validateAndProcessImage({ bytes: asBytes(png), declaredMimeType: "image/jpeg" }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("rejects an unsupported declared MIME type even when bytes are allowed", async () => {
    const jpeg = await solidJpeg(20, 20);
    await expect(
      validateAndProcessImage({ bytes: asBytes(jpeg), declaredMimeType: "image/heic" }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("accepts application/octet-stream and decides by actual bytes", async () => {
    const jpeg = await solidJpeg(20, 20);
    const result = await validateAndProcessImage({
      bytes: asBytes(jpeg),
      declaredMimeType: "application/octet-stream",
    });
    expect(result.sourceFormat).toBe("jpeg");
  });

  it("rejects GIF, TIFF, and other non-allowed formats with 415", async () => {
    await expect(
      validateAndProcessImage({ bytes: asBytes(TINY_GIF) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });

    const tiff = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .tiff()
      .toBuffer();
    await expect(
      validateAndProcessImage({ bytes: asBytes(tiff) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("rejects an empty file with 400", async () => {
    await expect(
      validateAndProcessImage({ bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("accepts exactly 10 MiB and rejects one byte over", async () => {
    const jpeg = await solidJpeg(40, 40);
    const exact = padTo(jpeg, IMAGE_MAX_BYTES);
    await expect(
      validateAndProcessImage({ bytes: asBytes(exact) }),
    ).resolves.toMatchObject({ sourceFormat: "jpeg" });

    const over = padTo(jpeg, IMAGE_MAX_BYTES + 1);
    await expect(
      validateAndProcessImage({ bytes: asBytes(over) }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("accepts 8192px on an axis and rejects 8193px", async () => {
    const allowed = await solidPng(8192, 1);
    await expect(
      validateAndProcessImage({ bytes: asBytes(allowed) }),
    ).resolves.toMatchObject({ sourceFormat: "png" });

    const rejected = await solidPng(8193, 1);
    await expect(
      validateAndProcessImage({ bytes: asBytes(rejected) }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it(
    "accepts exactly 32,000,000 pixels and rejects one row over",
    async () => {
      const allowed = await solidPng(6400, 5000);
      await expect(
        validateAndProcessImage({ bytes: asBytes(allowed) }),
      ).resolves.toMatchObject({ sourceFormat: "png" });

      const rejected = await solidPng(6400, 5001);
      await expect(
        validateAndProcessImage({ bytes: asBytes(rejected) }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    },
    60_000,
  );

  it("applies EXIF orientation and strips GPS/device metadata", async () => {
    // Synthetic 120x60 JPEG with Orientation=6, Make/Model and GPS IFD.
    const input = await readFile(fixture("oriented-gps.jpg"));

    const inputMetadata = await sharp(input).metadata();
    expect(inputMetadata.orientation).toBe(6);
    expect(inputMetadata.exif).toBeDefined();

    const result = await validateAndProcessImage({ bytes: asBytes(input) });
    expect(result.sourceWidth).toBe(60);
    expect(result.sourceHeight).toBe(120);
    expect(result.width).toBe(60);
    expect(result.height).toBe(120);

    for (const variant of result.variants) {
      const metadata = await sharp(Buffer.from(variant.bytes)).metadata();
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
    }
  });

  it("rejects a corrupt allowed format with 400", async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not a real png"),
    ]);
    await expect(
      validateAndProcessImage({ bytes: asBytes(corrupt) }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("rejects animated WebP and APNG with 415", async () => {
    const animatedWebp = await readFile(fixture("animated.webp"));
    await expect(
      validateAndProcessImage({ bytes: asBytes(animatedWebp) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });

    const animatedPng = await readFile(fixture("animated.png"));
    await expect(
      validateAndProcessImage({ bytes: asBytes(animatedPng) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  });
});
