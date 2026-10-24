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
  'bad-source.json': /sourceSegments\[0\]\.source/,
  'bad-caption.json': /currentLabel.*120/,
  'bad-label.json': /currentLabel.*120/,
  'bad-gen-status-type.json': /generation\.status 必须是对象/,
  'bad-gen-result-type.json': /generation\.status\.result 必须是非空字符串/,
  'bad-gen-input-type.json': /generation\.input 必须是非空字符串或对象/,
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

// 录音转写与原始讲述一字不差是合法的：两者是独立保存的两条来源，
// 归属由 sourceSegments[].source 区分，工程侧也从不比较这两段文本是否相同。
test('录音转写与原始讲述文字相同不报错', () => {
  const pack = load(join(okDir, 'base.json'));
  pack.facts.transcript = pack.facts.originalNarrative;
  assert.deepEqual(checkPack(pack).errors, []);
});

test('原始讲述与录音转写超过工程契约上限要报错', () => {
  const pack = load(join(okDir, 'base.json'));
  const tooLong = '旧'.repeat(12_001);

  pack.facts.originalNarrative = tooLong;
  const narErrors = checkPack(pack).errors;
  assert.equal(narErrors.length, 1, `实际：${JSON.stringify(narErrors)}`);
  assert.match(narErrors[0], /originalNarrative.*12000/);

  pack.facts.originalNarrative = '这东西是我爸年轻时用的，具体哪年记不清了。';
  pack.facts.transcript = tooLong;
  const trErrors = checkPack(pack).errors;
  assert.equal(trErrors.length, 1, `实际：${JSON.stringify(trErrors)}`);
  assert.match(trErrors[0], /transcript.*12000/);

  // 恰好 12000 字应当放行，避免把边界写成「小于」
  pack.facts.transcript = '旧'.repeat(12_000);
  assert.deepEqual(checkPack(pack).errors, []);
});

// 这一组全部是「类型不对但曾经零错误通过」的取值。
// 旧实现用 String(v ?? '') 判断是否为空，于是 false → "false"、0 → "0"、
// ['成功'] → "成功"，非法值被字符串化后伪装成非空，检查静默失效。
test('生成记录的非法类型不得静默通过', () => {
  const cases = [
    ['status 为布尔值', (p) => { p.generation.status = false; }, /generation\.status 必须是对象/],
    ['status 为 true', (p) => { p.generation.status = true; }, /generation\.status 必须是对象/],
    ['status 为数组', (p) => { p.generation.status = []; }, /generation\.status 必须是对象/],
    ['status 为字符串', (p) => { p.generation.status = '成功'; }, /generation\.status 必须是对象/],
    ['status 为 null', (p) => { p.generation.status = null; }, /generation\.status 不能为空/],
    ['result 为布尔值', (p) => { p.generation.status.result = true; }, /result 必须是非空字符串/],
    ['result 为数组', (p) => { p.generation.status.result = ['成功']; }, /result 必须是非空字符串/],
    ['result 为数字', (p) => { p.generation.status.result = 0; }, /result 必须是非空字符串/],
    ['durationMs 为数组', (p) => { p.generation.status.durationMs = []; }, /durationMs 必须是非空字符串/],
    ['costNote 为布尔值', (p) => { p.generation.status.costNote = false; }, /costNote 必须是非空字符串/],
    ['input 为数组', (p) => { p.generation.input = []; }, /input 必须是非空字符串或对象/],
    ['input 为布尔值', (p) => { p.generation.input = false; }, /input 必须是非空字符串或对象/],
    ['task 为数字', (p) => { p.generation.task = 123; }, /task 必须是非空字符串或对象/],
    ['output 为布尔值', (p) => { p.generation.status.result = '失败'; p.generation.output = false; }, /output 必须是非空字符串或 null/],
    ['generation 为数组', (p) => { p.generation = []; }, /generation 必须是对象或 null/],
  ];

  for (const [label, mutate, pattern] of cases) {
    const pack = load(join(okDir, 'base.json'));
    mutate(pack);
    const errors = checkPack(pack).errors;
    assert.ok(errors.length > 0, `${label} 应当被拦住，实际零错误通过`);
    assert.ok(
      errors.some((e) => pattern.test(e)),
      `${label} 应报出 ${pattern}，实际：${JSON.stringify(errors)}`,
    );
  }
});

// 合法取值不能被上面的严格类型检查误伤
test('合法的生成记录取值不被误伤', () => {
  const pack = load(join(okDir, 'base.json'));

  pack.generation.input = { assetId: 'asset-001', sha256: 'abc', version: 'v1' };
  pack.generation.task = { localTask: 'local-task-9', model: 'X 1.0' };
  assert.deepEqual(checkPack(pack).errors, [], 'input / task 允许写成对象');

  pack.generation = null;
  assert.deepEqual(checkPack(pack).errors, [], '没有生成记录时允许整项为 null');
});

// 应用契约 transcript 是 z.string()（无 min），空字符串合法；「没有录音」应写 null。
test('录音转写允许空字符串，但仍拒绝非字符串', () => {
  const pack = load(join(okDir, 'base.json'));

  pack.facts.transcript = '';
  assert.deepEqual(checkPack(pack).errors, [], '空字符串应放行');

  pack.facts.transcript = '   ';
  assert.deepEqual(checkPack(pack).errors, [], '纯空白同样合法');

  pack.facts.transcript = null;
  assert.deepEqual(checkPack(pack).errors, [], 'null 表示没有录音');

  for (const bad of [5, true, [], {}]) {
    pack.facts.transcript = bad;
    const errors = checkPack(pack).errors;
    assert.ok(errors.length > 0 && errors.some((e) => /transcript 必须是字符串/.test(e)),
      `transcript = ${JSON.stringify(bad)} 应被拦下，实际：${JSON.stringify(errors)}`);
  }
});

// 应用契约 textSchema 是 z.string().trim() 之后才计数，校验器必须先 trim 再比长度。
test('展签长度先去除首尾空白再计数', () => {
  const pack = load(join(okDir, 'base.json'));

  pack.curation.currentLabel = '展'.repeat(120) + '\n';
  assert.deepEqual(checkPack(pack).errors, [], '120 字正文加一个换行是合法内容');

  pack.curation.currentLabel = '  ' + '展'.repeat(120) + '  ';
  assert.deepEqual(checkPack(pack).errors, [], '首尾空白不计入长度');

  pack.curation.currentLabel = '展'.repeat(121);
  const errors = checkPack(pack).errors;
  assert.equal(errors.length, 1, `实际：${JSON.stringify(errors)}`);
  assert.match(errors[0], /去除首尾空白后有 121 字/);
});

// src/contracts/ai.ts 的 sourceSegmentsSchema 有四条限制，此前一条都没查：
// 单段 textSchema(1, 6000)、数组 max(40)、合计 reduce <= 12000。
// 校验器放过而应用存不下的内容包，正是这一类缺口。
test('来源片段受单段、数量与合计长度三重限制', () => {
  const seg = (id, text) => ({ id, source: 'rawStory', text });
  const setSegs = (pack, segs) => {
    pack.facts.sourceSegments = segs;
    pack.curation.aiDraft.sourceSegmentIds = segs.map((s) => s.id);
  };

  const ok = [
    ['单段 6000 字', [seg('S1', '旧'.repeat(6_000))]],
    ['合计 12000 字', [seg('S1', '旧'.repeat(6_000)), seg('S2', '旧'.repeat(6_000))]],
    ['40 段', Array.from({ length: 40 }, (_, i) => seg('S' + i, '短'))],
  ];
  for (const [label, segs] of ok) {
    const pack = load(join(okDir, 'base.json'));
    setSegs(pack, segs);
    assert.deepEqual(checkPack(pack).errors, [], `${label} 应当放行`);
  }

  const bad = [
    ['单段 6001 字', [seg('S1', '旧'.repeat(6_001))], /单段上限 6000/],
    ['合计 12001 字', Array.from({ length: 40 }, (_, i) => seg('S' + i, '旧'.repeat(301))), /合计 12040 字/],
    ['41 段', Array.from({ length: 41 }, (_, i) => seg('S' + i, '短')), /上限 40 段/],
  ];
  for (const [label, segs, pattern] of bad) {
    const pack = load(join(okDir, 'base.json'));
    setSegs(pack, segs);
    const errors = checkPack(pack).errors;
    assert.ok(errors.some((e) => pattern.test(e)),
      `${label} 应被拦下，实际：${JSON.stringify(errors)}`);
  }
});


