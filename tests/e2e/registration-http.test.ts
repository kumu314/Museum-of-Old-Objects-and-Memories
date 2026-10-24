import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { errorResponseSchema, museumListResponseSchema, museumDraftResponseSchema, sessionResponseSchema } from '../../src/contracts';

// 方案 B 选定的账号接入方式是用户名+密码自助注册。
// 这条回归同时覆盖 B01（拿到账号、登录、进入个人工作台）与注册产生的账号是否受归属隔离约束。
const base = process.env.E2E_BASE_URL;
if (!base) throw new Error('E2E_BASE_URL is required.');
const origin = new URL(base).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('Registration acceptance requires an isolated local server.');
}

const password = `pw-${randomUUID()}`;

function post(path: string, body: unknown, cookie?: string, withOrigin = true) {
  return fetch(new URL(path, origin), {
    method: 'POST',
    headers: { ...(withOrigin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
}
function get(path: string, cookie: string) {
  return fetch(new URL(path, origin), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
}
function cookieOf(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
async function failure(response: Response) {
  const error = errorResponseSchema.parse(await response.json()).error;
  return { status: response.status, code: error.code, message: error.message };
}

// 用例跑在一次性的临时库上，结束时整库丢弃，不需要逐个清理账号。
test('自助注册HTTP：校验、唯一性、注册即可用与归属隔离', async () => {
  const first = { username: `reg-${randomUUID().slice(0, 13)}`, password };
  const second = { username: `reg-${randomUUID().slice(0, 13)}`, password };

  // 长度与字符约束：密码短于 12、用户名含空格都必须先被契约挡下。
  const shortPassword = await failure(await post('/api/auth/register', { username: first.username, password: 'short' }));
  assert.deepEqual([shortPassword.status, shortPassword.code], [400, 'VALIDATION_ERROR']);
  const spaced = await failure(await post('/api/auth/register', { username: 'has space', password }));
  assert.deepEqual([spaced.status, spaced.code], [400, 'VALIDATION_ERROR']);
  // 写操作必须带正确来源，注册也不例外。
  const anonymous = await failure(await post('/api/auth/register', first, undefined, false));
  assert.deepEqual([anonymous.status, anonymous.code], [403, 'FORBIDDEN']);

  const registered = await post('/api/auth/register', first);
  assert.equal(registered.status, 201);
  const member = sessionResponseSchema.parse(await registered.json()).data;
  assert.equal(member.username, first.username);
  const firstCookie = cookieOf(registered);
  assert.ok(firstCookie);

  // 注册即登录：不要求用户再登录一次才能进个人工作台。
  const session = await get('/api/auth/session', firstCookie);
  assert.equal(session.status, 200);
  assert.equal(sessionResponseSchema.parse(await session.json()).data.id, member.id);
  const initial = await get('/api/museums', firstCookie);
  assert.equal(initial.status, 200);
  assert.deepEqual(museumListResponseSchema.parse(await initial.json()).data, []);

  // 用户名唯一性由数据库约束裁决，不用先查后插。
  const duplicate = await failure(await post('/api/auth/register', first));
  assert.deepEqual([duplicate.status, duplicate.code], [400, 'VALIDATION_ERROR']);
  assert.match(duplicate.message, /用户名已被占用/);

  // 用注册得到的凭据重新登录，验证恢复路径成立。
  const relogin = await post('/api/auth/login', first);
  assert.equal(relogin.status, 200);
  const reloginCookie = cookieOf(relogin);
  assert.ok(reloginCookie);

  const museum = await fetch(new URL('/api/museums', origin), {
    method: 'POST', headers: { Origin: origin, Cookie: reloginCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `注册账号的展馆 ${randomUUID()}`, description: '' }), signal: AbortSignal.timeout(15_000),
  });
  assert.equal(museum.status, 201);
  const museumId = museumDraftResponseSchema.parse(await museum.json()).data.id;

  // 第二个注册账号看不到第一个账号的展馆，直接构造 ID 也拿不到。
  const otherRegistered = await post('/api/auth/register', second);
  assert.equal(otherRegistered.status, 201);
  const secondCookie = cookieOf(otherRegistered);
  const otherList = await get('/api/museums', secondCookie);
  assert.equal(museumListResponseSchema.parse(await otherList.json()).data.some((item) => item.id === museumId), false);
  const denial = await failure(await get(`/api/museums/${museumId}`, secondCookie));
  assert.deepEqual([denial.status, denial.code], [404, 'NOT_FOUND']);
});

// 回归：注册与登录的节流计数器必须互不相干。
//
// 旧实现把用途拼进键里（'register:' + username），而用户名允许包含冒号，
// 于是名为 "register:alice" 的账号，其登录键与名为 "alice" 的注册键是同一个字符串。
// 实际后果：任何人反复注册 alice，就能让 register:alice 的持有者无法登录。
test('自助注册HTTP：注册节流不得锁死另一个账号的登录', async () => {
  const target = `thr-${randomUUID().slice(0, 12)}`;
  const victim = { username: `register:${target}`, password };

  assert.equal((await post('/api/auth/register', victim)).status, 201);
  // 第一次建号成功，之后每次重名失败也照常累加计数。
  assert.equal((await post('/api/auth/register', { username: target, password })).status, 201);
  // 注册成功会清空该账号的注册计数，所以从零开始累加：10 次重名到上限，
  // 第 11 次才被拒。数字写错会让下面的断言在旧代码上"碰巧通过"。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const duplicate = await failure(await post('/api/auth/register', { username: target, password }));
    assert.deepEqual([duplicate.status, duplicate.code], [400, 'VALIDATION_ERROR']);
  }
  // 必须真的被节流，否则不能证明计数已到上限，后面的断言也就失去意义。
  const throttled = await failure(await post('/api/auth/register', { username: target, password }));
  assert.deepEqual([throttled.status, throttled.code], [401, 'UNAUTHORIZED']);
  assert.match(throttled.message, /注册尝试过多/);

  // 核心断言：受害账号密码正确，不得被另一个账号的注册计数牵连。
  const login = await post('/api/auth/login', victim);
  assert.equal(login.status, 200, '注册计数不应影响其它账号的登录');
  assert.ok(cookieOf(login));

  // 反向同理：注册被节流后，同名账号的正常登录也必须照旧可用。
  // 把两种用途合并成一个计数器（而不是分成两列）会在这里失败，
  // 那等于任何人都能用注册接口反复打满别人的登录额度。
  const sameName = await post('/api/auth/login', { username: target, password });
  assert.equal(sameName.status, 200, '注册节流不应波及同名账号的登录');
});
