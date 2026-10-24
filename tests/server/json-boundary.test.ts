import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExhibitInputSchema, updateExhibitInputSchema, type CreateExhibitInput } from '../../src/contracts/museum';
import { exhibitJsonBodyLimit, HttpError, readJsonRequest } from '../../src/server/http';

function streamingRequest(stream: ReadableStream<Uint8Array>) {
  const options: RequestInit & { duplex: 'half' } = {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
  };
  return new Request('http://127.0.0.1/json', options);
}

function chunkedRequest(body: string) {
  const bytes = Buffer.from(body);
  let offset = 0;
  return streamingRequest(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      // Deliberately split multibyte characters and JSON escapes across chunks.
      const end = Math.min(offset + 1021, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }));
}

function maximumExhibitValues(character: string): Omit<CreateExhibitInput, 'expectedMuseumVersion'> {
  const asset = '00000000-0000-4000-8000-000000000001';
  return {
    name: character.repeat(80), era: character.repeat(80), slotIndex: 2_147_483_647, modelKey: 'photo-plane',
    caption: character.repeat(120), photoAssetId: asset, audioAssetId: asset,
    approximation: character.repeat(500), sourceNotice: character.repeat(1000),
    modelInput: { mode: 'multiview', views: { front: asset, back: asset, left: asset, right: asset } },
    rawStory: character.repeat(12_000), transcript: character.repeat(12_000),
    sourceSegments: Array.from({ length: 40 }, (_, index) => ({
      id: `${character.repeat(79)}${String.fromCodePoint(0x20000 + index)}`,
      source: 'transcript', text: character.repeat(300),
    })),
  };
}

function escapedJson(value: unknown): string {
  // JSON permits every string code unit, including keys, to use \uXXXX.
  return JSON.stringify(value).replace(/"(?:\\.|[^"\\])*"/g, (token) => {
    const text: unknown = JSON.parse(token);
    assert.ok(typeof text === 'string');
    return `"${text.split('').map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`;
  });
}

for (const character of ['旧', '𠮷', '\u0001']) {
  test(`展品创建和更新完整接收最大原文、分段及展示文本：${JSON.stringify(character)}`, async () => {
    const values = maximumExhibitValues(character);
    const inputs = [
      { schema: createExhibitInputSchema, input: { ...values, expectedMuseumVersion: Number.MAX_SAFE_INTEGER } },
      { schema: updateExhibitInputSchema, input: { ...values, expectedVersion: Number.MAX_SAFE_INTEGER } },
    ];
    for (const { schema, input } of inputs) {
      const expected = schema.parse(input);
      for (const serialize of [JSON.stringify, escapedJson]) {
        const body = serialize(input);
        assert.ok(Buffer.byteLength(body) > 65_536, '用例必须超过旧请求上限');
        assert.ok(Buffer.byteLength(body) <= exhibitJsonBodyLimit, '完整合法字段必须能装入展品请求上限');
        const parsed = await readJsonRequest(chunkedRequest(body), exhibitJsonBodyLimit);
        assert.deepEqual(schema.parse(parsed), expected);
      }
    }
  });
}

function tooLarge(error: unknown) {
  assert.ok(error instanceof HttpError);
  assert.equal(error.failure.code, 'PAYLOAD_TOO_LARGE');
  return true;
}

test('默认请求仍限制为 64 KiB，展品专用上限不会扩大其他入口', async () => {
  const input = createExhibitInputSchema.parse({ ...maximumExhibitValues('旧'), expectedMuseumVersion: 1 });
  await assert.rejects(readJsonRequest(chunkedRequest(JSON.stringify(input))), tooLarge);
});

for (const limit of [65_536, exhibitJsonBodyLimit]) {
  test(`请求上限 ${limit} bytes：恰好达到时通过，多一个字节即拒绝并取消剩余流`, async () => {
    const value = 'x'.repeat(limit - 2);
    assert.equal(await readJsonRequest(chunkedRequest(JSON.stringify(value)), limit), value);
    let cancelled = false;
    let chunks = 0;
    const request = streamingRequest(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(chunks === 1 ? Buffer.from(JSON.stringify(value)) : new Uint8Array([32]));
      },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(readJsonRequest(request, limit), tooLarge);
    assert.equal(cancelled, true);
    assert.equal(request.body?.locked, false);
  });
}
