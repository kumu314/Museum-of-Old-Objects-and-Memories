import { z } from 'zod';

/**
 * 服务端配置的唯一权威定义。类型从 schema 推导，不另写一份。
 * 错误信息只报字段名，不回显字段值——连接串里带密码。
 */
const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().min(1),
  })
  .refine((value) => value.DATABASE_URL !== value.TEST_DATABASE_URL, {
    path: ['TEST_DATABASE_URL'],
    message: '测试库必须与开发库不同',
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
    throw new Error(`服务端配置缺失或非法：${[...new Set(fields)].join('、')}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** 首次读取时校验并缓存。构建阶段不读取，部署缺少配置时在首个请求处失败。 */
export function getEnv(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}
