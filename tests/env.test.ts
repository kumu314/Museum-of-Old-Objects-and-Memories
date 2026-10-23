import { describe, expect, it } from 'vitest';
import { loadEnv } from '@/server/config/env';

const dev = 'postgresql://app@localhost:5432/shihuguan_dev';
const test = 'postgresql://app@localhost:5432/shihuguan_test';

describe('loadEnv', () => {
  it('两个库不同时返回解析后的配置', () => {
    expect(loadEnv({ DATABASE_URL: dev, TEST_DATABASE_URL: test })).toEqual({
      DATABASE_URL: dev,
      TEST_DATABASE_URL: test,
    });
  });

  it('测试库与开发库相同时拒绝', () => {
    expect(() => loadEnv({ DATABASE_URL: dev, TEST_DATABASE_URL: dev })).toThrow(
      /TEST_DATABASE_URL/,
    );
  });

  it('缺少必填项时指出字段名且不回显取值', () => {
    let message = '';
    try {
      loadEnv({ TEST_DATABASE_URL: test });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain(test);
  });
});
