import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { uploadLimits } from '../../src/contracts/assets';
import { HttpError } from '../../src/server/http';
import { cleanupUncommittedAsset, prepareAsset, processAsset, resolveAssetPath } from '../../src/server/assets';

const executeFile = promisify(execFile);
let workspace: string;
before(async () => { workspace = await mkdtemp(join(tmpdir(), 'museum-assets-test-')); });
after(async () => { await rm(workspace, { recursive: true, force: true }); });
function rejectsCode(code: string) {
  return (error: unknown) => { assert.ok(error instanceof HttpError); assert.equal(error.failure.code, code); return true; };
}
async function image(width = 48, height = 24, format: 'jpeg' | 'png' | 'webp' = 'png'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#b48e5c' } }).toFormat(format).toBuffer();
}
function wave(byteLength: number, encoding = 1): Buffer {
  assert.ok(byteLength >= 44 && byteLength % 2 === 0);
  const buffer = Buffer.alloc(byteLength);
  buffer.write('RIFF'); buffer.writeUInt32LE(byteLength - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(encoding, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(byteLength - 44, 40);
  return buffer;
}
async function encodedAudio(filename: string, codec: string): Promise<Buffer> {
  const path = join(workspace, filename);
  await executeFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.2', '-c:a', codec, path], { timeout: 15_000 });
  return readFile(path);
}

test('static JPEG PNG WebP are parsed, reencoded and returned with genuine output dimensions', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const processed = await processAsset({ inputBuffer: await image(48, 24, format), originalName: `photo.${format}`, mime: `image/${format}` });
    assert.equal(processed.kind, 'image');
    if (processed.kind !== 'image') throw new Error('Expected image');
    assert.equal(processed.contentType, 'image/webp');
    assert.deepEqual([processed.width, processed.height], [48, 24]);
    assert.equal((await sharp(processed.bytes).metadata()).format, 'webp');
    assert.equal((await sharp(processed.thumbnailBytes).metadata()).format, 'webp');
  }
});

test('EXIF orientation is applied before removing location, device and XMP metadata from both outputs', async () => {
  const inputBuffer = await sharp(await image(40, 20)).withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'TEST-DEVICE', Model: 'PRIVATE-CAMERA' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 12/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '121/1 30/1 0/1' } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="31,12.0N"/></rdf:RDF></x:xmpmeta>')
    .jpeg().toBuffer();
  const input = await sharp(inputBuffer).metadata();
  assert.equal(input.orientation, 6); assert.ok(input.exif); assert.ok(input.xmp);
  assert.ok(input.xmp.includes(Buffer.from('31,12.0N')));
  assert.ok(input.exif.includes(Buffer.from('TEST-DEVICE')));
  const output = await processAsset({ inputBuffer, originalName: 'location.jpg', mime: 'image/jpeg' });
  assert.equal(output.kind, 'image');
  if (output.kind !== 'image') throw new Error('Expected image');
  assert.deepEqual([output.width, output.height], [20, 40]);
  for (const buffer of [output.bytes, output.thumbnailBytes]) {
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.orientation, undefined);
    for (const key of ['exif', 'xmp', 'iptc', 'icc'] as const) assert.equal(metadata[key], undefined);
    assert.equal(buffer.includes(Buffer.from('TEST-DEVICE')), false);
    assert.equal(buffer.includes(Buffer.from('GPSLatitude')), false);
  }
});

test('signature, extension, MIME and actual parse must agree; corrupt accepted formats produce 400', async () => {
  const png = await image();
  for (const upload of [
    { inputBuffer: png, originalName: 'wrong.jpg', mime: 'image/jpeg' },
    { inputBuffer: png, originalName: 'wrong.png', mime: 'image/jpeg' },
    { inputBuffer: Buffer.from('GIF89a123'), originalName: 'wrong.png', mime: 'image/png' },
    { inputBuffer: png, originalName: 'wrong.svg', mime: 'image/svg+xml' },
  ]) await assert.rejects(processAsset(upload), rejectsCode('UNSUPPORTED_MEDIA_TYPE'));
  for (const inputBuffer of [png.subarray(0, 30), Buffer.from('damaged input'), Buffer.from([0xff, 0xd8, 0xff, 1])]) {
    await assert.rejects(processAsset({ inputBuffer, originalName: inputBuffer[0] === 0xff ? 'broken.jpg' : 'broken.png', mime: inputBuffer[0] === 0xff ? 'image/jpeg' : 'image/png' }), rejectsCode('VALIDATION_ERROR'));
  }
});

test('valid animated PNG and WebP are rejected before a frame can be silently selected', async () => {
  for (const [filename, encoding] of [['animated.png', 'apng'], ['animated.webp', 'libwebp_anim']] as const) {
    const path = join(workspace, filename);
    await executeFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=16x16:rate=2', '-frames:v', '2', '-c:v', encoding, ...(encoding === 'apng' ? ['-f', 'apng'] : []), path], { timeout: 15_000 });
    await assert.rejects(processAsset({ inputBuffer: await readFile(path), originalName: filename, mime: filename.endsWith('.png') ? 'image/png' : 'image/webp' }), rejectsCode('UNSUPPORTED_MEDIA_TYPE'));
  }
});

test('exact image byte limit succeeds; limit plus one fails before parsing', async () => {
  const jpeg = await image(48, 24, 'jpeg');
  // JPEG permits trailing bytes after EOI; the decoder still verifies the actual image.
  const inputBuffer = Buffer.concat([jpeg, Buffer.alloc(uploadLimits.imageBytes - jpeg.length)]);
  const result = await processAsset({ inputBuffer, originalName: 'boundary.jpg', mime: 'image/jpeg' });
  assert.equal(result.kind, 'image');
  await assert.rejects(processAsset({ inputBuffer: Buffer.concat([inputBuffer, Buffer.from([0])]), originalName: 'boundary.jpg', mime: 'image/jpeg' }), rejectsCode('PAYLOAD_TOO_LARGE'));
});

test('8192 axis succeeds; either 8193 axis fails, while total pixels stay below the limit', async () => {
  for (const [width, height, accepted] of [[8192, 1, true], [1, 8192, true], [8193, 1, false], [1, 8193, false]] as const) {
    const task = processAsset({ inputBuffer: await image(width, height), originalName: 'dimension.png', mime: 'image/png' });
    if (accepted) assert.equal((await task).kind, 'image');
    else await assert.rejects(task, rejectsCode('VALIDATION_ERROR'));
  }
});

test('32000000 input pixels succeed; 6400 by 5001 is rejected before full decode', async () => {
  const accepted = await processAsset({ inputBuffer: await image(6400, 5000), originalName: 'pixels.png', mime: 'image/png' });
  assert.equal(accepted.kind, 'image');
  await assert.rejects(processAsset({ inputBuffer: await image(6400, 5001), originalName: 'pixels.png', mime: 'image/png' }), rejectsCode('VALIDATION_ERROR'));
});

test('real MP3, M4A AAC and WAV PCM pass probe and complete decode', async () => {
  const examples = [
    { inputBuffer: await encodedAudio('voice.mp3', 'libmp3lame'), originalName: 'voice.mp3', mime: 'audio/mpeg' },
    { inputBuffer: await encodedAudio('voice.m4a', 'aac'), originalName: 'voice.m4a', mime: 'audio/mp4' },
    { inputBuffer: wave(16044), originalName: 'voice.wav', mime: 'audio/wav' },
  ];
  for (const example of examples) {
    const output = await processAsset(example);
    assert.equal(output.kind, 'audio');
    assert.deepEqual(output.bytes, example.inputBuffer);
  }
});

test('common browser MIME aliases and MP3 cover art remain valid audio uploads', async () => {
  assert.equal((await processAsset({ inputBuffer: wave(16044), originalName: 'voice.wav', mime: 'audio/x-wav' })).contentType, 'audio/wav');
  const audio = join(workspace, 'cover-source.mp3');
  await encodedAudio('cover-source.mp3', 'libmp3lame');
  const cover = join(workspace, 'cover.jpg');
  await writeFile(cover, await image(48, 24, 'jpeg'));
  const target = join(workspace, 'with-cover.mp3');
  await executeFile('ffmpeg', ['-v', 'error', '-i', audio, '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'copy', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', target], { timeout: 15_000 });
  assert.equal((await processAsset({ inputBuffer: await readFile(target), originalName: 'cover.mp3', mime: 'audio/mpeg' })).kind, 'audio');
});

test('ALAC M4A and mu-law WAV are unsupported; truncated WAV cannot be accepted from headers alone', async () => {
  await assert.rejects(processAsset({ inputBuffer: await encodedAudio('alac.m4a', 'alac'), originalName: 'alac.m4a', mime: 'audio/mp4' }), rejectsCode('UNSUPPORTED_MEDIA_TYPE'));
  await assert.rejects(processAsset({ inputBuffer: await encodedAudio('mulaw.wav', 'pcm_mulaw'), originalName: 'mulaw.wav', mime: 'audio/wav' }), rejectsCode('UNSUPPORTED_MEDIA_TYPE'));
  await assert.rejects(processAsset({ inputBuffer: wave(16044).subarray(0, 120), originalName: 'truncated.wav', mime: 'audio/wav' }), rejectsCode('VALIDATION_ERROR'));
});

test('missing ffprobe/ffmpeg is a controlled server failure', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    await assert.rejects(
      processAsset({ inputBuffer: wave(16044), originalName: 'voice.wav', mime: 'audio/wav' }),
      rejectsCode('INTERNAL_ERROR'),
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('exact 20 MiB valid PCM WAV succeeds and one extra byte returns 413', async () => {
  const inputBuffer = wave(uploadLimits.audioBytes);
  assert.equal((await processAsset({ inputBuffer, originalName: 'boundary.wav', mime: 'audio/wav' })).kind, 'audio');
  await assert.rejects(processAsset({ inputBuffer: Buffer.concat([inputBuffer, Buffer.from([0])]), originalName: 'boundary.wav', mime: 'audio/wav' }), rejectsCode('PAYLOAD_TOO_LARGE'));
});

test('private preparation retains complete unique files; cleanup never removes referenced assets or uncertain lookups', async () => {
  const directory = join(workspace, 'private');
  const processed = await processAsset({ inputBuffer: await image(), originalName: 'photo.png', mime: 'image/png' });
  const prepared = await prepareAsset(processed, directory);
  const replacement = await prepareAsset(processed, directory);
  assert.notEqual(prepared.storageKey, replacement.storageKey);
  assert.deepEqual(await readFile(resolveAssetPath(directory, prepared.storageKey)), processed.bytes);
  assert.ok(prepared.thumbnailStorageKey);
  assert.equal(await cleanupUncommittedAsset(prepared, directory, 'rolled-back', async () => true), false);
  await assert.rejects(cleanupUncommittedAsset(prepared, directory, 'rolled-back', async () => { throw new Error('DB uncertain'); }), /DB uncertain/);
  assert.deepEqual(await readFile(resolveAssetPath(directory, prepared.storageKey)), processed.bytes);
  assert.equal(await cleanupUncommittedAsset(replacement, directory, 'rolled-back', async () => false), true);
  assert.deepEqual(await readdir(directory), [prepared.id]);
  assert.throws(() => resolveAssetPath(directory, '../public/leak.webp'));
  await assert.rejects(prepareAsset(processed, resolve('public/..uploads')), /outside public/);
  const fakeApp = join(workspace, 'fake-app');
  const publicDirectory = join(fakeApp, 'public');
  const alias = join(workspace, 'public-alias');
  await mkdir(publicDirectory, { recursive: true });
  try {
    // Windows may require Developer Mode for symlinks; a directory junction tests the same alias.
    await symlink(publicDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error instanceof Error && 'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')) return;
    throw error;
  }
  const originalCwd = process.cwd();
  try {
    process.chdir(fakeApp);
    await assert.rejects(prepareAsset(processed, alias), /outside public/);
  } finally { process.chdir(originalCwd); }
});
