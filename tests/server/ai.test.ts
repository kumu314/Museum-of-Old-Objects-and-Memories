import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import { aiInputSchema } from '../../src/contracts/ai';
import { HttpError, errorResponse } from '../../src/server/http';
import { generateDraft, readAiConfig } from '../../src/server/integrations/ai';

const input = aiInputSchema.parse({
  name: '复古相机',
  era: '年代待考',
  sourceVersion: 1,
  sourceSegments: [{ id: 'story-1', source: 'rawStory', text: '家里有一台旧相机，具体是什么时候买的我记不清，可能是很多年前。' }],
});
const output = {
  caption: '这是一件用于测试整理流程的旧物。物主只记得大约在多年前取得，具体年代记不清。现有描述不足以确认制作时间、使用经过及相关人物，仍需根据原始讲述进一步核对。',
  questions: ['是否还有购置时间的相关线索？'],
  sourceSegmentIds: ['story-1'],
};

function preserveEnvironment(context: TestContext) {
  const names = ['AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  context.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

async function localService(context: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  preserveEnvironment(context);
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.AI_MODEL = 'local-fixture-model';
  process.env.AI_API_KEY = 'local-stub-key';
}

function sendCompletion(response: ServerResponse, content: string) {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }));
}

async function expectAiError(operation: Promise<unknown>, code: 'AI_UNAVAILABLE' | 'AI_TIMEOUT', status: number) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.failure.code, code);
    assert.equal(errorResponse(error, '00000000-0000-4000-8000-000000000001').status, status);
    return true;
  });
}

test('本地兼容服务收到隔离的system/user消息，返回经来源校验的展签草稿', async (context) => {
  const requests: { url: string | undefined; authorization: string | undefined; body: string }[] = [];
  await localService(context, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    request.on('end', () => {
      requests.push({ url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      sendCompletion(response, JSON.stringify(output));
    });
  });
  const original = structuredClone(input);
  assert.deepEqual(await generateDraft(input), output);
  assert.deepEqual(input, original);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.authorization, 'Bearer local-stub-key');
  const sent = z.object({
    model: z.literal('local-fixture-model'),
    messages: z.tuple([
      z.object({ role: z.literal('system'), content: z.string() }),
      z.object({ role: z.literal('user'), content: z.string() }),
    ]),
    response_format: z.object({ type: z.literal('json_object') }),
    max_completion_tokens: z.literal(1_024),
    stream: z.literal(false),
  }).parse(JSON.parse(request.body));
  assert.deepEqual(JSON.parse(sent.messages[1].content), input);
  assert.ok(sent.messages[0].content.includes('不得补造人物'));
  assert.ok(!sent.messages[0].content.includes(input.sourceSegments[0]?.text ?? 'missing source'));
});

test('无效JSON、伪造来源与过大响应均为502，未自动重试且输入不变', async (context) => {
  let mode: 'json' | 'source' | 'large' = 'json';
  let count = 0;
  await localService(context, (_request, response) => {
    count += 1;
    if (mode === 'large') {
      // Chunked transfer exercises the streaming bound without Content-Length.
      response.write(' '.repeat(65_537));
      response.end();
    } else sendCompletion(response, mode === 'json' ? '{' : JSON.stringify({ ...output, sourceSegmentIds: ['invented'] }));
  });
  const original = structuredClone(input);
  await expectAiError(generateDraft(input), 'AI_UNAVAILABLE', 502);
  mode = 'source';
  await expectAiError(generateDraft(input), 'AI_UNAVAILABLE', 502);
  mode = 'large';
  await expectAiError(generateDraft(input), 'AI_UNAVAILABLE', 502);
  assert.equal(count, 3);
  assert.deepEqual(input, original);
});

test('AI未配置时明确不可用，不查找其他凭据或生成演示答案', async (context) => {
  preserveEnvironment(context);
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_API_KEY;
  assert.throws(() => readAiConfig({ AI_BASE_URL: 'https://example.invalid/v1', AI_API_KEY: 'local-stub-key' }), HttpError);
  await expectAiError(generateDraft(input), 'AI_UNAVAILABLE', 502);
});

test('真实HTTP请求30秒未完成时被中止并返回504', { timeout: 35_000 }, async (context) => {
  let requests = 0;
  await localService(context, (request) => {
    requests += 1;
    request.resume();
  });
  const original = structuredClone(input);
  const started = performance.now();
  await expectAiError(generateDraft(input), 'AI_TIMEOUT', 504);
  assert.ok(performance.now() - started >= 29_500);
  assert.equal(requests, 1);
  assert.deepEqual(input, original);
});
