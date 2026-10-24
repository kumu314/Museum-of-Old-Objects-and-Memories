import 'server-only';
import { randomUUID } from 'node:crypto';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { teamMemberSchema, type LoginInput, type RegisterInput } from '../../contracts/session';
import { getServerConfig } from '../config';
import { getPool, withTransaction } from '../db/pool';
import { HttpError } from '../http';
import { hashPassword, verifyPassword } from './password';
import { allowUnknownLoginAttempt } from './unknown-login-throttle';

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
  return new HttpError({ code: 'UNAUTHORIZED', message: '请先登录账号。' });
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
const throttleLimit = 10;
type ThrottleScope = 'login' | 'register';

/**
 * 按 (用途, 用户名) 计数。用途放在独立的列而不是拼进键里，
 * 否则名为 "register:alice" 的账号会与 alice 的注册计数共用同一行。
 */
async function countAttempt(scope: ThrottleScope, username: string): Promise<number> {
  const result = await getPool().query<{ attempts: number }>(
    `INSERT INTO login_attempts(scope,username,attempts,window_started_at) VALUES($1,$2,1,now())
     ON CONFLICT(scope,username) DO UPDATE SET
       attempts=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
       window_started_at=CASE WHEN login_attempts.window_started_at<now()-interval '5 minutes' THEN now() ELSE login_attempts.window_started_at END
     RETURNING attempts`, [scope, username],
  );
  return result.rows[0]?.attempts ?? throttleLimit + 1;
}

export async function loginMember(input: LoginInput) {
  const pool = getPool();
  const result = await pool.query('SELECT id,username,password_hash FROM team_members WHERE username=$1 AND active', [input.username]);
  const member = z.object({ id: z.uuid(), username: z.string(), password_hash: z.string() }).optional().parse(result.rows[0]);
  // Unknown usernames must not create unbounded rows in the throttle table.
  if (!member) {
    if (!allowUnknownLoginAttempt()) {
      throw new HttpError({ code: 'UNAUTHORIZED', message: '登录尝试过多，请五分钟后重试。' });
    }
    await verifyPassword(input.password, `scrypt:${'0'.repeat(48)}:${'0'.repeat(128)}`);
    throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  }
  const attempts = await countAttempt('login', input.username);
  if (attempts > throttleLimit) throw new HttpError({ code: 'UNAUTHORIZED', message: '登录尝试过多，请五分钟后重试。' });
  const accepted = await verifyPassword(input.password, member.password_hash);
  if (!accepted) throw new HttpError({ code: 'UNAUTHORIZED', message: '账号或密码不正确。' });
  const session = await cookieSession();
  const sessionId = randomUUID();
  await withTransaction(async (db) => {
    if (session.sessionId) await db.query('DELETE FROM team_sessions WHERE id=$1', [session.sessionId]);
    await db.query('DELETE FROM team_sessions WHERE expires_at <= now()');
    await db.query("INSERT INTO team_sessions(id,member_id,expires_at) VALUES($1,$2,now()+$3::integer*interval '1 second')", [sessionId, member.id, lifetimeSeconds]);
    // 只清登录计数。清全表会顺带放行同名账号的注册节流，等于开了一个绕过口子。
    await db.query("DELETE FROM login_attempts WHERE scope='login' AND username=$1", [input.username]);
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

/**
 * 用户名+密码自助注册（方案 B 选定的账号接入方式）。
 * 注册成功即建立会话，省去用户再登录一次；role 只记来源，不参与授权。
 */
export async function registerUser(input: RegisterInput) {
  if (!getServerConfig().selfRegistration) {
    throw new HttpError({ code: 'FORBIDDEN', message: '当前未开放自助注册，请联系管理员开通账号。' });
  }
  const attempts = await countAttempt('register', input.username);
  if (attempts > throttleLimit) throw new HttpError({ code: 'UNAUTHORIZED', message: '注册尝试过多，请五分钟后重试。' });

  const passwordHash = await hashPassword(input.password);
  const session = await cookieSession();
  const sessionId = randomUUID();
  let memberId: string;
  try {
    memberId = await withTransaction(async (db) => {
      const created = await db.query<{ id: string }>(
        "INSERT INTO team_members(username,password_hash,role) VALUES($1,$2,'user') RETURNING id",
        [input.username, passwordHash],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error('Registered member could not be read back.');
      if (session.sessionId) await db.query('DELETE FROM team_sessions WHERE id=$1', [session.sessionId]);
      await db.query('DELETE FROM team_sessions WHERE expires_at <= now()');
      await db.query("INSERT INTO team_sessions(id,member_id,expires_at) VALUES($1,$2,now()+$3::integer*interval '1 second')",
        [sessionId, id, lifetimeSeconds]);
      await db.query("DELETE FROM login_attempts WHERE scope='register' AND username=$1", [input.username]);
      return id;
    });
  } catch (error) {
    // 并发注册同一用户名时唯一约束是最终裁决，不靠先查后插。
    if (isUniqueViolation(error)) throw new HttpError({ code: 'VALIDATION_ERROR', message: '该用户名已被占用，请换一个。' });
    throw error;
  }
  session.sessionId = sessionId;
  await session.save();
  return teamMemberSchema.parse({ id: memberId, username: input.username });
}
