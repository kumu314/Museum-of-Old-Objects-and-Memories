import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { getIsolatedTestDatabaseUrl } from './db/test-database';

const postgresUrl = z.url().refine((value) => ['postgres:', 'postgresql:'].includes(URL.parse(value)?.protocol ?? ''));
const environmentSchema = z.object({
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl,
  SESSION_PASSWORD: z.string().min(32),
  APP_ORIGIN: z.url().refine((value) => {
    const url = URL.parse(value);
    return url !== null && ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }),
  UPLOAD_DIR: z.string().min(1).refine((value) => {
    const fromPublic = relative(resolve('public'), resolve(value));
    return isAbsolute(value) && (fromPublic === '..' || fromPublic.startsWith(`..${sep}`));
  }),
  // 方案 B 采用用户名+密码自助注册。生产要临时关闭时设 SELF_REGISTRATION=closed，
  // 归属与权限判断不受这个开关影响。
  SELF_REGISTRATION: z.enum(['open', 'closed']).default('open'),
  DEMO_ALLOW_HTTP: z.enum(['true', 'false']).default('false'),
});

export function parseServerConfig(environment: Readonly<Record<string, string | undefined>>) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid server configuration: ${names.join(', ')}`);
  }
  const value = parsed.data;
  getIsolatedTestDatabaseUrl(environment);
  if (environment.NODE_ENV === 'production' && !value.APP_ORIGIN.startsWith('https://') && value.DEMO_ALLOW_HTTP !== 'true') {
    throw new Error('Production APP_ORIGIN must use HTTPS');
  }
  return {
    databaseUrl: value.DATABASE_URL,
    testDatabaseUrl: value.TEST_DATABASE_URL,
    sessionPassword: value.SESSION_PASSWORD,
    appOrigin: value.APP_ORIGIN,
    secureCookies: value.APP_ORIGIN.startsWith('https://'),
    uploadDir: value.UPLOAD_DIR,
    selfRegistration: value.SELF_REGISTRATION === 'open',
  };
}

let config: ReturnType<typeof parseServerConfig> | undefined;
export function getServerConfig() {
  config ??= parseServerConfig(process.env);
  return config;
}
