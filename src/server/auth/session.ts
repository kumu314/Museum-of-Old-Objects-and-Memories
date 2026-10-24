import 'server-only';
import { randomUUID } from 'node:crypto';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { sessionUserSchema, type LoginInput, type RegisterInput } from '../../contracts/session';
import { getServerConfig } from '../config';
import { getPool, withTransaction } from '../db/pool';
import { HttpError } from '../http';
import { hashPassword, verifyPassword } from './password';

const lifetimeSeconds = 8 * 60 * 60;
const cookieSchema = z.strictObject({ sessionId: z.uuid() });
async function cookieSession() {
  return getIronSession<{ sessionId?: string }>(await cookies(), {
    cookieName: 'shiwuguan-session',
    password: getServerConfig().sessionPassword,
    ttl: lifetimeSeconds,
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
  });
}
function unauthorized() {
  return new HttpError({ code: 'UNAUTHORIZED', message: '请先登录。' });
}
export async function requireUser() {
  const cookie = await cookieSession();
  const session = cookieSchema.safeParse({ sessionId: cookie.sessionId });
  if (!session.success) throw unauthorized();
  const result = await getPool().query(
    `SELECT u.id, u.username FROM user_sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id=$1 AND s.expires_at>now() AND u.active`, [session.data.sessionId],
  );
  if (result.rowCount !== 1) throw unauthorized();
  return sessionUserSchema.parse(result.rows[0]);
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== getServerConfig().appOrigin) {
    throw new HttpError({ code: 'FORBIDDEN', message: '请求来源无效，请从制作页面重新操作。' });
  }
}
// One throttled attempt window per username; unknown usernames never insert rows.
async function throttle(username: string) {
  const limit = await getPool().query<{ attempts: number }>(
    `INSERT INTO login_attempts(username,attempts,window_started_at) VALUES($1,1,now())
     ON CONFLICT(username) DO UPDATE SET
       attempts=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
       window_started_at=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN now() ELSE login_attempts.window_started_at END
     RETURNING attempts`, [username],
  );
  if ((limit.rows[0]?.attempts ?? 11) > 10) throw new HttpError({ code: 'UNAUTHORIZED', message: '尝试过多，请五分钟后重试。' });
}
async function startSession(userId: string) {
  const session = await cookieSession();
  const sessionId = randomUUID();
  await withTransaction(async (db) => {
    if (session.sessionId) await db.query('DELETE FROM user_sessions WHERE id=$1', [session.sessionId]);
    await db.query('DELETE FROM user_sessions WHERE expires_at <= now()');
    await db.query("INSERT INTO user_sessions(id,user_id,expires_at) VALUES($1,$2,now()+$3::integer*interval '1 second')", [sessionId, userId, lifetimeSeconds]);
  });
  session.sessionId = sessionId;
  await session.save();
}
export async function loginUser(input: LoginInput) {
  const pool = getPool();
  const result = await pool.query('SELECT id,username,password_hash FROM users WHERE username=$1 AND active', [input.username]);
  const user = z.object({ id: z.uuid(), username: z.string(), password_hash: z.string() }).optional().parse(result.rows[0]);
  // Unknown usernames must not create unbounded rows in the throttle table.
  if (!user) {
    await verifyPassword(input.password, `scrypt:${'0'.repeat(48)}:${'0'.repeat(128)}`);
    throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  }
  await throttle(input.username);
  const accepted = await verifyPassword(input.password, user.password_hash);
  if (!accepted) throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  await startSession(user.id);
  await pool.query('DELETE FROM login_attempts WHERE username=$1', [input.username]);
  return sessionUserSchema.parse({ id: user.id, username: user.username });
}
export async function registerUser(input: RegisterInput) {
  const pool = getPool();
  await throttle(input.username);
  const passwordHash = await hashPassword(input.password);
  const inserted = await pool.query<{ id: string }>('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id',
    [input.username, passwordHash]).catch((error: unknown) => {
    // A concurrent registration with the same name hits the unique constraint.
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new HttpError({ code: 'VALIDATION_ERROR', message: '用户名已被注册，请换一个。' });
    }
    throw error;
  });
  const userId = inserted.rows[0]?.id;
  if (!userId) throw new Error('Registered user could not be read back.');
  await startSession(userId);
  await pool.query('DELETE FROM login_attempts WHERE username=$1', [input.username]);
  return sessionUserSchema.parse({ id: userId, username: input.username });
}
export async function logoutUser() {
  const session = await cookieSession();
  if (session.sessionId) await getPool().query('DELETE FROM user_sessions WHERE id=$1', [session.sessionId]);
  session.destroy();
}
