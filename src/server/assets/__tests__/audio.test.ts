import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUDIO_MAX_BYTES,
  validateAudio,
} from "../index.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/audio/${name}`, import.meta.url));
}

async function fixtureBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixture(name)));
}

function padTo(buffer: Uint8Array, size: number): Uint8Array {
  const padded = new Uint8Array(size);
  padded.set(buffer);
  return padded;
}

describe("audio validation", () => {
  it("accepts PCM WAV", async () => {
    const bytes = await fixtureBytes("tone.wav");
    const result = await validateAudio({ bytes });

    expect(result.kind).toBe("audio");
    expect(result.format).toBe("wav");
    expect(result.mimeType).toBe("audio/wav");
    expect(result.byteLength).toBe(bytes.byteLength);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bytes).toEqual(bytes);
  });

  it("accepts MP3", async () => {
    const bytes = await fixtureBytes("tone.mp3");
    const result = await validateAudio({ bytes });
    expect(result.format).toBe("mp3");
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("accepts AAC in an M4A container", async () => {
    const bytes = await fixtureBytes("tone.m4a");
    const result = await validateAudio({ bytes });
    expect(result.format).toBe("m4a");
    expect(result.mimeType).toBe("audio/mp4");
  });

  it("rejects ALAC inside M4A with 415", async () => {
    const bytes = await fixtureBytes("tone_alac.m4a");
    await expect(validateAudio({ bytes })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("rejects float WAV with 415", async () => {
    const bytes = await fixtureBytes("tone_float.wav");
    await expect(validateAudio({ bytes })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("rejects Ogg with 415", async () => {
    const bytes = await fixtureBytes("tone.ogg");
    await expect(validateAudio({ bytes })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("rejects an MP4 carrying a video track with 415", async () => {
    const bytes = await fixtureBytes("tone_video_track.bin");
    await expect(validateAudio({ bytes })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("rejects a declared MIME type that does not match the bytes", async () => {
    const bytes = await fixtureBytes("tone.mp3");
    await expect(
      validateAudio({ bytes, declaredMimeType: "audio/mp4" }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("accepts an unknown MIME and decides by actual bytes", async () => {
    const bytes = await fixtureBytes("tone.m4a");
    const result = await validateAudio({
      bytes,
      declaredMimeType: "application/octet-stream",
    });
    expect(result.format).toBe("m4a");
  });

  it("accepts common MIME aliases", async () => {
    const wav = await fixtureBytes("tone.wav");
    await expect(
      validateAudio({ bytes: wav, declaredMimeType: "audio/x-wav" }),
    ).resolves.toMatchObject({ format: "wav" });

    const mp3 = await fixtureBytes("tone.mp3");
    await expect(
      validateAudio({ bytes: mp3, declaredMimeType: "audio/mp3" }),
    ).resolves.toMatchObject({ format: "mp3" });

    const m4a = await fixtureBytes("tone.m4a");
    await expect(
      validateAudio({ bytes: m4a, declaredMimeType: "audio/x-m4a" }),
    ).resolves.toMatchObject({ format: "m4a" });
  });

  it("rejects an empty file with 400", async () => {
    await expect(
      validateAudio({ bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("rejects a corrupt MP3 with 400", async () => {
    const corrupt = new Uint8Array(
      Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000", "binary"),
    );
    await expect(validateAudio({ bytes: corrupt })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("rejects truncated WAV and M4A with 400", async () => {
    const wav = await fixtureBytes("tone.wav");
    await expect(
      validateAudio({ bytes: wav.slice(0, 1_000) }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    const m4a = await fixtureBytes("tone.m4a");
    await expect(
      validateAudio({ bytes: m4a.slice(0, 80) }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("accepts exactly 20 MiB and rejects one byte over", async () => {
    const wav = await fixtureBytes("tone.wav");
    const exact = padTo(wav, AUDIO_MAX_BYTES);
    await expect(validateAudio({ bytes: exact })).resolves.toMatchObject({
      format: "wav",
    });

    const over = padTo(wav, AUDIO_MAX_BYTES + 1);
    await expect(validateAudio({ bytes: over })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });
});
