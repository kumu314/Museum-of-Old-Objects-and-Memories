import { z } from 'zod';

/**
 * 服务端配置的唯一权威定义。类型从 schema 推导，不另写一份。
 * 错误信息只报字段名，不回显字段值——连接串里带密码。
 */
const DatabaseUrl = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  try {
    decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  return (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname.length > 0 && url.pathname.length > 1 &&
    !['host', 'hostaddr', 'port', 'dbname', 'database'].some((key) => url.searchParams.has(key));
}, '必须使用包含主机和库名的 PostgreSQL URL，连接目标不能由查询参数覆盖');

function databaseTarget(value: string): string {
  const url = new URL(value);
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname.toLowerCase();
  return `${host}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}

const EnvSchema = z
  .object({
    DATABASE_URL: DatabaseUrl,
    TEST_DATABASE_URL: DatabaseUrl,
  })
  .refine((value) => {
    if (!DatabaseUrl.safeParse(value.DATABASE_URL).success || !DatabaseUrl.safeParse(value.TEST_DATABASE_URL).success) return true;
    return databaseTarget(value.DATABASE_URL) !== databaseTarget(value.TEST_DATABASE_URL);
  }, {
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
