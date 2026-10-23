import 'server-only';
import { Pool } from 'pg';

/** Web、迁移和集成测试共用连接参数，连接失败不能无限等待。 */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
}
