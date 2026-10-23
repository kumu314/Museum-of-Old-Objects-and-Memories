import 'server-only';
import { randomUUID } from 'node:crypto';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { teamMemberSchema, type LoginInput } from '../../contracts/session';
import { getServerConfig } from '../config';
import { getPool, withTransaction } from '../db/pool';
import { HttpError } from '../http';
import { verifyPassword } from './password';

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
  return new HttpError({ code: 'UNAUTHORIZED', message: '请登录团队制作账号。' });
}
export async function requireMember() {
  const cookie = await cookieSession();
  const session = cookieSchema.safeParse({ sessionId: cookie.sessionId });
  if (!session.success) throw unauthorized();
  const result = await getPool().query(
    `SELECT m.id, m.username FROM team_sessions s JOIN team_members m ON m.id=s.member_id
     WHERE s.id=$1 AND s.expires_at>now() AND m.active`, [session.data.sessionId],
  );
  if (result.rowCount !== 1) throw unauthorized();
  return teamMemberSchema.parse(result.rows[0]);
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== getServerConfig().appOrigin) {
    throw new HttpError({ code: 'FORBIDDEN', message: '请求来源无效，请从制作页面重新操作。' });
  }
}
export async function loginMember(input: LoginInput) {
  const pool = getPool();
  const result = await pool.query('SELECT id,username,password_hash FROM team_members WHERE username=$1 AND active', [input.username]);
  const member = z.object({ id: z.uuid(), username: z.string(), password_hash: z.string() }).optional().parse(result.rows[0]);
  // Unknown usernames must not create unbounded rows in the throttle table.
  if (!member) {
    await verifyPassword(input.password, `scrypt:${'0'.repeat(48)}:${'0'.repeat(128)}`);
    throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  }
  const limit = await pool.query<{ attempts: number }>(
    `INSERT INTO login_attempts(username,attempts,window_started_at) VALUES($1,1,now())
     ON CONFLICT(username) DO UPDATE SET
       attempts=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
       window_started_at=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN now() ELSE login_attempts.window_started_at END
     RETURNING attempts`, [input.username],
  );
  if ((limit.rows[0]?.attempts ?? 11) > 10) throw new HttpError({ code: 'UNAUTHORIZED', message: '登录尝试过多，请五分钟后重试。' });
  const accepted = await verifyPassword(input.password, member.password_hash);
  if (!accepted) throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  const session = await cookieSession();
  const sessionId = randomUUID();
  await withTransaction(async (db) => {
    if (session.sessionId) await db.query('DELETE FROM team_sessions WHERE id=$1', [session.sessionId]);
    await db.query('DELETE FROM team_sessions WHERE expires_at <= now()');
    await db.query("INSERT INTO team_sessions(id,member_id,expires_at) VALUES($1,$2,now()+$3::integer*interval '1 second')", [sessionId, member.id, lifetimeSeconds]);
    await db.query('DELETE FROM login_attempts WHERE username=$1', [input.username]);
  });
  session.sessionId = sessionId;
  await session.save();
  return teamMemberSchema.parse({ id: member.id, username: member.username });
}
export async function logoutMember() {
  const session = await cookieSession();
  if (session.sessionId) await getPool().query('DELETE FROM team_sessions WHERE id=$1', [session.sessionId]);
  session.destroy();
}
