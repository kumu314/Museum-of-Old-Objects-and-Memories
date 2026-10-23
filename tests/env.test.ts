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

  it('不同账号、协议别名和默认端口仍指向同一库时拒绝', () => {
    expect(() => loadEnv({
      DATABASE_URL: 'postgresql://dev@localhost/shiwuguan',
      TEST_DATABASE_URL: 'postgres://test@127.0.0.1:5432/shiwuguan',
    })).toThrow(/TEST_DATABASE_URL/);
  });

  it.each(['invalid', 'https://localhost/database', 'postgresql://localhost', 'postgresql://localhost/%invalid', 'postgresql://localhost/dev?dbname=production'])(
    '拒绝非法连接配置 %s，且不回显取值', (value) => {
      expect(() => loadEnv({ DATABASE_URL: value, TEST_DATABASE_URL: test })).toThrow(
        '服务端配置缺失或非法：DATABASE_URL',
      );
    },
  );

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
