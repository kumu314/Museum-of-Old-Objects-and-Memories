import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPack } from '../../scripts/content/check-content-pack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const okDir = join(here, '../fixtures/content-pack/ok');
const badDir = join(here, '../fixtures/content-pack/bad');

const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
const errorsOf = (file) => checkPack(load(file)).errors;

// 每个不合格样例只改一个字段，错误信息必须指到那个字段。
const EXPECTED = {
  'bad-gen.json': /generation\.output/,
  'bad-cost.json': /generation\.status\.costNote/,
  'bad-scope.json': /confirmation\.shareScope/,
  'bad-transcript.json': /transcript 与 originalNarrative 完全相同/,
  'bad-source.json': /sourceSegments\[0\]\.source/,
  'bad-caption.json': /currentLabel.*120/,
  'bad-label.json': /currentLabel.*120/,
};

test('合格样例没有错误', () => {
  for (const name of readdirSync(okDir)) {
    assert.deepEqual(errorsOf(join(okDir, name)), [], `${name} 不应有错误`);
  }
});

test('每个不合格样例都报出对应字段', () => {
  for (const [name, pattern] of Object.entries(EXPECTED)) {
    const errors = errorsOf(join(badDir, name));
    assert.ok(errors.length > 0, `${name} 应当被拦住`);
    assert.ok(errors.some((e) => pattern.test(e)), `${name} 应报出 ${pattern}，实际：${JSON.stringify(errors)}`);
  }
});

test('v0.6 形状的包只因展签超长报错，不因 visibility 报错', () => {
  const errors = errorsOf(join(badDir, 'bad-label.json'));
  assert.equal(errors.length, 1, `实际：${JSON.stringify(errors)}`);
  assert.match(errors[0], /currentLabel/);
});

test('失败或执行中的任务允许没有输出，成功必须有输出', () => {
  const pack = load(join(okDir, 'base.json'));
  pack.generation.output = null;

  pack.generation.status.result = '失败';
  assert.deepEqual(checkPack(pack).errors, [], '失败任务不应被要求填输出');

  pack.generation.status.result = '执行中';
  assert.deepEqual(checkPack(pack).errors, [], '执行中任务不应被要求填输出');

  pack.generation.status.result = '成功';
  const errors = checkPack(pack).errors;
  assert.equal(errors.length, 1, `实际：${JSON.stringify(errors)}`);
  assert.match(errors[0], /generation\.output/);
});

test('生成状态只认排队 / 执行中 / 成功 / 失败', () => {
  const pack = load(join(okDir, 'base.json'));
  pack.generation.status.result = '完成';
  const errors = checkPack(pack).errors;
  assert.equal(errors.length, 1, `实际：${JSON.stringify(errors)}`);
  assert.match(errors[0], /generation\.status\.result/);
});
