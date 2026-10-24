import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceSegmentsSchema } from '../../contracts/ai';
import { sourceSegmentsFromText } from './source-segments';

test('反复保存保留未改讲述的来源标识，修改只替换对应片段', () => {
  const previous = sourceSegmentsFromText('父亲的相机。\n\n大概是冬天。', null, []);
  assert.deepEqual(sourceSegmentsFromText('父亲的相机。\n\n大概是冬天。', null, previous), previous);
  const changed = sourceSegmentsFromText('父亲的相机。\n\n记不清季节了。', null, previous);
  assert.equal(changed[0]?.id, previous[0]?.id);
  assert.notEqual(changed[1]?.id, previous[1]?.id);
  assert.equal(previous[1]?.text, '大概是冬天。');
});

test('相同文字的录音整理与原始讲述保持不同来源；重复段落不共用标识', () => {
  const previous = sourceSegmentsFromText('再靠近一点。\n\n再靠近一点。', '再靠近一点。', []);
  assert.equal(new Set(previous.map((segment) => segment.id)).size, 3);
  assert.deepEqual(sourceSegmentsFromText('再靠近一点。\n\n再靠近一点。', '再靠近一点。', previous), previous);
  assert.equal(previous[2]?.source, 'transcript');
});

test('超长讲述按 Unicode 字符分段，不截断增补平面字符；空白不制造来源', () => {
  const text = '𠮷'.repeat(6001);
  const segments = sourceSegmentsFromText(text, ' \n ', []);
  assert.equal(segments.length, 2);
  assert.equal(Array.from(segments[0]?.text ?? '').length, 6000);
  assert.equal(segments[1]?.text, '𠮷');
  assert.equal(segments.map((segment) => segment.text).join(''), text);
});

test('超过40个短段落时只合并相邻同来源片段，保留原文并符合保存契约', () => {
  const paragraphs = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index}，记不清了。`).join('\n\n');
  for (const [rawStory, transcript] of [
    [paragraphs(41, '旧物'), null],
    [paragraphs(21, '讲述'), paragraphs(20, '录音')],
    [paragraphs(41, '讲述'), paragraphs(41, '录音')],
    ['𠮷'.repeat(6_000), paragraphs(41, '录音')],
  ] as const) {
    const segments = sourceSegmentsFromText(rawStory, transcript, []);
    sourceSegmentsSchema.parse(segments);
    assert.equal(segments.filter(({ source }) => source === 'rawStory').map(({ text }) => text).join('\n\n'), rawStory);
    assert.equal(segments.filter(({ source }) => source === 'transcript').map(({ text }) => text).join('\n\n'), transcript ?? '');
    assert.deepEqual(sourceSegmentsFromText(rawStory, transcript, segments), segments);
  }
});

test('合并保留原文的空行、空格与缩进，所有片段都通过 AI 原文子串核对', () => {
  for (const separator of ['\n\n\n', '\n \n', '\n\t\n', '\r\n\r\n', '  \n\n  ']) {
    const paragraphs = Array.from({ length: 41 }, (_, index) => `第${index}段𠮷的讲述。`);
    for (const source of ['rawStory', 'transcript'] as const) {
      const original = `  ${paragraphs.join(separator)}  `;
      const rawStory = source === 'rawStory' ? original : '';
      const transcript = source === 'transcript' ? original : null;
      const segments = sourceSegmentsSchema.parse(sourceSegmentsFromText(rawStory, transcript, []));
      assert.equal(segments.length, 40);
      assert.equal(segments[0]?.text, `${paragraphs[0]}${separator}${paragraphs[1]}`);
      for (const segment of segments) {
        assert.equal(segment.source, source);
        assert.ok(original.includes(segment.text));
      }
      assert.deepEqual(sourceSegmentsFromText(rawStory, transcript, segments), segments);
    }
  }
});

test('合并预算包含原始空白，跳过超限组合后合并后续段落且不丢字', () => {
  const first = '𠮷'.repeat(5_999);
  const rest = Array.from({ length: 40 }, (_, index) => `讲述${index}。`);
  const separator = '\n' + ' '.repeat(100) + '\n';
  const rawStory = `${first}${separator}${rest.join(separator)}`;
  assert.ok(Array.from(rawStory).length <= 12_000);
  const segments = sourceSegmentsSchema.parse(sourceSegmentsFromText(rawStory, null, []));
  assert.equal(segments.length, 40);
  assert.equal(segments[0]?.text, first);
  assert.equal(segments[1]?.text, `${rest[0]}${separator}${rest[1]}`);
  assert.equal(segments.map(({ text }) => text).join(separator), rawStory);
  assert.ok(segments.every(({ text }) => rawStory.includes(text)));
  assert.deepEqual(sourceSegmentsFromText(rawStory, null, segments), segments);
});
