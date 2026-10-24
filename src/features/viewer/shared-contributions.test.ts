import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SharedContribution } from '../../contracts/contributors';
import { authorLabel, groupContributions } from './shared-contributions';

function contribution(overrides: Partial<SharedContribution> & Pick<SharedContribution, 'id' | 'exhibitId'>): SharedContribution {
  return {
    authorName: '讲述者', authorRole: 'coauthor', story: '一段讲述', sourceNote: '来源',
    ...overrides,
  };
}

test('按展品分组，同一展品的多份讲述保持服务端给的顺序', () => {
  const grouped = groupContributions([
    contribution({ id: 'c1', exhibitId: 'e1', story: '先讲的' }),
    contribution({ id: 'c2', exhibitId: 'e2', story: '另一件上的' }),
    contribution({ id: 'c3', exhibitId: 'e1', story: '后补的' }),
  ]);
  assert.deepEqual(grouped.get('e1')?.map((item) => item.story), ['先讲的', '后补的']);
  assert.deepEqual(grouped.get('e2')?.map((item) => item.story), ['另一件上的']);
});

test('没有讲述的展品不在分组里，调用方要自己兜底成空数组', () => {
  const grouped = groupContributions([contribution({ id: 'c1', exhibitId: 'e1' })]);
  assert.equal(grouped.get('e2'), undefined);
  assert.equal(grouped.size, 1);
});

test('空输入得到空 Map，不是抛错', () => {
  assert.equal(groupContributions([]).size, 0);
});

test('物主与共同讲述者的标签必须不同，不能都叫讲述者', () => {
  assert.equal(authorLabel('owner'), '物主');
  assert.equal(authorLabel('coauthor'), '共同讲述者');
  assert.notEqual(authorLabel('owner'), authorLabel('coauthor'));
});
