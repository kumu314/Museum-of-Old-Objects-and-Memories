import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiInputSchema, aiOutputForSourcesSchema, confirmExhibitInputSchema,
  errorResponseSchema, exhibitDraftSchema, publicExhibitSchema, publicMuseumSchema,
  toPublicExhibit, toMuseumDisplay, museumDraftSchema, updateExhibitInputSchema,
} from '../../src/contracts';

const exhibitId = '00000000-0000-4000-8000-000000000001';
const museumId = '00000000-0000-4000-8000-000000000002';
const otherExhibitId = '00000000-0000-4000-8000-000000000003';
const timestamp = '2026-10-23T00:00:00.000Z';

const editableExhibit = {
  name: '复古相机',
  era: '年代待考',
  slotIndex: 0,
  modelKey: 'camera-01',
  caption: '这是一件明确标记的演示模型，尚未提供物主讲述。',
  photoAssetId: null,
  audioAssetId: null,
  modelInput: { mode: 'single', imageAssetId: null },
  approximation: '近似演示模型，非实物精确复原',
  sourceNotice: '测试样例，不作为真实物主资料',
  rawStory: '  原始输入的空格与换行应保留。\n',
  transcript: null,
  sourceSegments: [],
};

const draft = exhibitDraftSchema.parse({
  ...editableExhibit,
  id: exhibitId,
  museumId,
  version: 1,
  confirmedVersion: null,
  confirmationNote: null,
  confirmedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

test('公开投影只含展示字段，公开边界拒绝内部讲述、AI草稿与存储路径', () => {
  const result = toPublicExhibit(draft);
  assert.equal(result.sourceNotice, editableExhibit.sourceNotice);
  assert.equal(result.name, editableExhibit.name);
  assert.ok(!('rawStory' in result));
  assert.ok(!('sourceSegments' in result));
  assert.ok(!('confirmedVersion' in result));
  for (const field of ['rawStory', 'transcript', 'aiDraft', 'storagePath']) {
    assert.equal(publicExhibitSchema.safeParse({ ...result, [field]: 'private' }).success, false);
  }
});

test('本人预览可展示尚未确认的草稿，但序列化数据不带原始讲述或建模输入', () => {
  const museum = museumDraftSchema.parse({ id: museumId, title: '私有预览', description: '全馆简介', version: 1, publishedVersion: null, shareEnabled: false,
    regionCity: null, createdAt: timestamp, updatedAt: timestamp, exhibits: [{ ...draft, caption: '', modelKey: 'photo-plane' }] });
  const display = toMuseumDisplay(museum);
  assert.equal(display.exhibits[0]?.caption, '');
  assert.equal(publicMuseumSchema.safeParse({ ...display, publishedAt: timestamp }).success, false);
  for (const key of ['rawStory', 'sourceSegments', 'modelInput', 'confirmationNote']) assert.equal(key in (display.exhibits[0] ?? {}), false);
});

test('保存完整白名单与显式版本，缺省不会意外清空素材，原始讲述不被改写', () => {
  const input = { ...editableExhibit, expectedVersion: 3 };
  assert.equal(updateExhibitInputSchema.parse(input).rawStory, editableExhibit.rawStory);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, confirmedVersion: 3 }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, storagePath: '/private/path' }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, photoAssetId: undefined }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, expectedVersion: '3' }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, modelKey: 'https://external/model.glb' }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, slotIndex: 6 }).success, true);
  for (const slotIndex of [-1, 0.5, 2_147_483_648]) assert.equal(updateExhibitInputSchema.safeParse({ ...input, slotIndex }).success, false);
  assert.equal(updateExhibitInputSchema.safeParse({ ...input, modelInput: undefined }).success, false);
});

test('人工确认必须含版本和可追溯说明，不能提交自动确认标记', () => {
  assert.equal(confirmExhibitInputSchema.safeParse({ expectedVersion: 2, confirmationNote: '已核对版本 2 的线下确认记录。' }).success, true);
  assert.equal(confirmExhibitInputSchema.safeParse({ expectedVersion: 2, confirmationNote: '   ' }).success, false);
  assert.equal(confirmExhibitInputSchema.safeParse({ expectedVersion: 2, confirmationNote: '已核对', automatic: true }).success, false);
  assert.equal(exhibitDraftSchema.safeParse({ ...draft, confirmedVersion: 1 }).success, false);
  assert.equal(exhibitDraftSchema.safeParse({ ...draft, confirmedVersion: 1, confirmationNote: '已核对', confirmedAt: timestamp }).success, true);
});

test('NOT_CONFIRMED必须提供非空且唯一的展品ID，其他错误不携带内部详情', () => {
  const error = { code: 'NOT_CONFIRMED', message: '请先确认展品。', requestId: 'test-request' };
  const response = (ids: string[]) => ({ error: { ...error, details: { unconfirmedExhibitIds: ids } } });
  assert.equal(errorResponseSchema.safeParse(response([exhibitId, otherExhibitId])).success, true);
  assert.equal(errorResponseSchema.safeParse({ error }).success, false);
  assert.equal(errorResponseSchema.safeParse(response([])).success, false);
  assert.equal(errorResponseSchema.safeParse(response([exhibitId, exhibitId])).success, false);
  assert.equal(errorResponseSchema.safeParse({ error: { ...error, code: 'INTERNAL_ERROR', details: { stack: 'private' } } }).success, false);
});

test('发布展示数据拒绝重复格位、重复展品以及缺图的实拍薄片', () => {
  const exhibit = toPublicExhibit(draft);
  const museum = { id: museumId, title: '样例馆', description: '', version: 1, publishedAt: timestamp, exhibits: [exhibit] };
  assert.equal(publicMuseumSchema.safeParse(museum).success, true);
  assert.equal(publicMuseumSchema.safeParse({ ...museum, exhibits: [exhibit, { ...exhibit, id: otherExhibitId }] }).success, false);
  assert.equal(publicMuseumSchema.safeParse({ ...museum, exhibits: [exhibit, { ...exhibit, slotIndex: 1 }] }).success, false);
  assert.equal(publicExhibitSchema.safeParse({ ...exhibit, modelKey: 'photo-plane' }).success, false);
});

test('AI字数按Unicode字符校验60与120边界，来源必须属于本次输入且追问最多两项', () => {
  const source = { id: 'story-1', source: 'rawStory' as const, text: '这件旧物的年代记不清了。' };
  const schema = aiOutputForSourcesSchema([source]);
  const output = { caption: '字'.repeat(60), questions: [], sourceSegmentIds: ['story-1'] };
  assert.equal(schema.safeParse(output).success, true);
  assert.equal(schema.safeParse({ ...output, caption: '字'.repeat(59) }).success, false);
  assert.equal(schema.safeParse({ ...output, caption: '𠮷'.repeat(120) }).success, true);
  assert.equal(schema.safeParse({ ...output, caption: '字'.repeat(121) }).success, false);
  assert.equal(schema.safeParse({ ...output, sourceSegmentIds: ['invented'] }).success, false);
  assert.equal(schema.safeParse({ ...output, sourceSegmentIds: ['story-1', 'story-1'] }).success, false);
  assert.equal(schema.safeParse({ ...output, questions: ['何时取得？', '从谁处取得？'] }).success, true);
  assert.equal(schema.safeParse({ ...output, questions: ['何时？', '何人？', '何地？'] }).success, false);
  assert.equal(schema.safeParse({ ...output, confirmed: true }).success, false);
});

test('AI输入必须有可追溯片段与来源版本，重复片段和过量输入被拒绝', () => {
  const segment = { id: 'story-1', source: 'rawStory', text: '约在多年前取得，具体时间记不清。' };
  const input = { name: '复古相机', era: '年代待考', sourceVersion: 1, sourceSegments: [segment] };
  assert.equal(aiInputSchema.safeParse(input).success, true);
  assert.equal(aiInputSchema.safeParse({ ...input, sourceSegments: [] }).success, false);
  assert.equal(aiInputSchema.safeParse({ ...input, sourceSegments: [segment, segment] }).success, false);
  assert.equal(aiInputSchema.safeParse({ ...input, sourceSegments: [
    { ...segment, text: '字'.repeat(6_000) },
    { ...segment, id: 'story-2', text: '字'.repeat(6_000) },
    { ...segment, id: 'story-3', text: '字' },
  ] }).success, false);
});
