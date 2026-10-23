import 'server-only';
import type { Pool } from 'pg';
import { getEnv } from '@/server/config/env';
import { createPool } from '@/server/db/connection';

/**
 * 单例连接池。只在服务端模块里引用，客户端组件 import 本文件会在构建期报错。
 *
 * 挂在 globalThis 上而不是模块作用域：Next dev 的 HMR 每次热更新都会重新执行模块，
 * 模块级变量会被重置，池越攒越多，本地很容易把 PostgreSQL 的连接数打满。
 */
const globalForPg = globalThis as typeof globalThis & { __pgPool?: Pool };

export function getPool(): Pool {
  const existing = globalForPg.__pgPool;
  if (existing) return existing;

  const created = createPool(getEnv().DATABASE_URL);
  globalForPg.__pgPool = created;
  return created;
}
