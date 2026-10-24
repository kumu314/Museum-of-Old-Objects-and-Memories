import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { hashPassword } from '../src/server/auth/password';
import { migrate } from '../src/server/db/migrate';
import { getIsolatedTestDatabaseUrl } from '../src/server/db/test-database';

// Only the temporary database created by this run is removed during cleanup.
const databaseUrl = new URL(getIsolatedTestDatabaseUrl());
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.port !== '15433' || databaseUrl.username !== 'shiwuguan') {
  throw new Error('HTTP regression requires the local Compose test database on port 15433. Run pnpm db:local first.');
}
const database = `http_test_${randomUUID().replaceAll('-', '')}`;
databaseUrl.pathname = `/${database}`;
const username = 'http-regression';
const password = randomBytes(24).toString('base64url');
// 归属隔离必须由两个互相独立的账号证明：同一账号只能验证馆级隔离，不能验证用户隔离。
const secondUsername = 'http-regression-other';
const secondPassword = randomBytes(24).toString('base64url');
const root = process.cwd();
await mkdir('.local', { recursive: true });
const directory = await mkdtemp(resolve('.local/http-regression-'));
const appDirectory = join(directory, 'app');
const log = await open(join(directory, 'server.log'), 'wx', 0o600);
let databaseCreated = false;
let server: ChildProcess | undefined;
let serverExited: Promise<void> | undefined;

function sql(statement: string) {
  const result = spawnSync('docker', ['compose', '-f', 'compose.local.yml', 'exec', '-T', 'test',
    'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe', timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Temporary HTTP database operation failed: ${result.stderr.toString()}`);
}

async function freePort() {
  const socket = createServer();
  await new Promise<void>((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done); });
  const address = socket.address();
  await new Promise<void>((done, reject) => socket.close((error) => error ? reject(error) : done()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate an HTTP regression port.');
  return address.port;
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const pid = server.pid;
  // Windows 没有进程组语义，负 pid 会抛 ESRCH 并盖住真正的失败原因。
  const signal = (value: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') server?.kill(value);
      else process.kill(-pid, value);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  };
  signal('SIGTERM');
  const force = setTimeout(() => signal('SIGKILL'), 5000);
  try { await serverExited; } finally { clearTimeout(force); }
}

try {
  sql(`CREATE DATABASE ${database} OWNER shiwuguan`);
  databaseCreated = true;
  const pool = new Pool({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5000 });
  try {
    await migrate(pool);
    await pool.query('INSERT INTO team_members(username,password_hash,role) VALUES($1,$2,$3)', [username, await hashPassword(password), 'member']);
    await pool.query('INSERT INTO team_members(username,password_hash,role) VALUES($1,$2,$3)', [secondUsername, await hashPassword(secondPassword), 'user']);
  } finally { await pool.end(); }

  // Separate source/build/upload directories keep existing development servers intact.
  await mkdir(appDirectory);
  for (const path of ['src', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'migrations']) {
    await cp(join(root, path), join(appDirectory, path), { recursive: true });
  }
  // Windows 上创建目录符号链接需要额外特权，会以 EPERM 失败；junction 不需要特权，语义在此等价。
  await symlink(join(root, 'node_modules'), join(appDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(join(directory, 'uploads'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl.href,
    SESSION_PASSWORD: randomBytes(48).toString('base64url'), APP_ORIGIN: origin, UPLOAD_DIR: join(directory, 'uploads'),
    AI_API_KEY: '', AI_BASE_URL: '', AI_MODEL: '', NEXT_TELEMETRY_DISABLED: '1', SELF_REGISTRATION: 'open',
    E2E_BASE_URL: origin, E2E_USERNAME: username, E2E_PASSWORD: password,
    E2E_SECOND_USERNAME: secondUsername, E2E_SECOND_PASSWORD: secondPassword };
  const app = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: appDirectory, env: environment, stdio: ['ignore', log.fd, log.fd], detached: true });
  server = app;
  let startupError: Error | undefined;
  serverExited = new Promise<void>((done) => {
    app.once('error', (error) => { startupError = error; done(); });
    app.once('exit', () => done());
  });
  let ready = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (app.exitCode !== null || app.signalCode !== null) throw new Error('HTTP regression server exited before becoming ready.');
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) { ready = true; break; }
    } catch (error) {
      // Connection refusals/timeouts are expected while Next starts and compiles health.
      if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'TimeoutError')) throw error;
    }
    await delay(250);
  }
  if (!ready) throw new Error('HTTP regression server did not become healthy within 90 seconds.');
  console.log('Isolated HTTP regression server ready.');
  const tests = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-timeout=180000',
    'tests/e2e/api-core.test.ts', 'tests/e2e/assets-http.test.ts', 'tests/e2e/ownership-http.test.ts',
    'tests/e2e/registration-http.test.ts', 'tests/e2e/share-access.test.ts'], { cwd: root, env: environment, stdio: 'inherit' });
  const code = await new Promise<number>((done, reject) => { tests.once('error', reject); tests.once('exit', (value) => done(value ?? 1)); });
  if (code !== 0) throw new Error(`HTTP regression failed with exit code ${code}.`);
} catch (error) {
  console.error(`HTTP regression diagnostics: ${join(directory, 'server.log')}`);
  throw error;
} finally {
  await stopServer();
  await log.close();
  if (databaseCreated) sql(`DROP DATABASE ${database} WITH (FORCE)`);
  await rm(join(directory, 'uploads'), { recursive: true, force: true });
  await rm(appDirectory, { recursive: true, force: true });
}
