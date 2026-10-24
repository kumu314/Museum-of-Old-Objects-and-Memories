import { z } from 'zod';
import { getPool, closePool } from '../src/server/db/pool';
import { hashPassword } from '../src/server/auth/password';

// TEAM_ROLE 只是账号来源标记，不参与授权；归属一律看 museums.created_by。
const role = z.enum(['member', 'user']).default('member').parse(process.env.TEAM_ROLE ?? undefined);
const credentials = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(12).max(256) })
  .safeParse({ username: process.env.TEAM_USERNAME, password: process.env.TEAM_PASSWORD });
if (!credentials.success) throw new Error('TEAM_USERNAME and TEAM_PASSWORD (12–256 characters) are required.');
try {
  await getPool().query('INSERT INTO team_members(username,password_hash,role) VALUES($1,$2,$3)',
    [credentials.data.username, await hashPassword(credentials.data.password), role]);
  process.stdout.write(`Team member created with role ${role}. Existing accounts are never overwritten.\n`);
} finally { await closePool(); }
