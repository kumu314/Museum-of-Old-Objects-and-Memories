import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

await mkdir('.local/uploads', { recursive: true, mode: 0o700 });
const passwords = {};
for (const name of ['development', 'test']) {
  const path = `.local/${name}-db.env`;
  try {
    await writeFile(path, `POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nSHIWUGUAN_APP_PASSWORD=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  passwords[name] = (await readFile(path, 'utf8')).match(/^SHIWUGUAN_APP_PASSWORD=(\w+)$/m)?.[1];
  if (!passwords[name]) throw new Error(`Missing app password in ${path}`);
}
const config = `DATABASE_URL=postgresql://shiwuguan:${passwords.development}@127.0.0.1:15432/shiwuguan\nTEST_DATABASE_URL=postgresql://shiwuguan:${passwords.test}@127.0.0.1:15433/shiwuguan\nSESSION_PASSWORD=${randomBytes(48).toString('base64url')}\nAPP_ORIGIN=http://127.0.0.1:17682\nUPLOAD_DIR=${resolve('.local/uploads')}\n`;
try {
  await writeFile('.env.local', config, { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  process.stdout.write('Preserved existing .env.local; verify its database endpoints.\n');
}
const result = spawnSync('docker', ['compose', '-f', 'compose.local.yml', 'up', '-d', '--wait'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
