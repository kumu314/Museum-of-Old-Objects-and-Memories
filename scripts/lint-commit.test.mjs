import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const checker = fileURLToPath(new URL('./lint-commit.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'museum commit lint '));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'unused-global-config'),
    GIT_AUTHOR_NAME: 'Fixture User',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture User',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[key];
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const lint = (...args) => {
    const result = spawnSync(process.execPath, [checker, ...args], {
      cwd: root, encoding: 'utf8', env,
    });
    if (result.error) throw result.error;
    return result;
  };
  git('init', '-b', 'feature');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(root, 'unused-hooks'));
  git('commit', '--allow-empty', '-m', 'chore: 初始化检查样例');
  const base = git('rev-parse', 'HEAD');
  const messageFile = join(root, 'message.txt');
  return { root, git, lint, base, messageFile };
}

function prepareMerge(t, upstreamTitle = 'feat: 上游功能') {
  const f = fixture(t);
  f.git('checkout', '-b', 'upstream');
  f.git('commit', '--allow-empty', '-m', upstreamTitle);
  f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.git('checkout', 'feature');
  f.git('commit', '--allow-empty', '-m', 'feat: 本地功能');
  f.git('merge', '--no-commit', '--no-ff', 'origin/main');
  return f;
}

test('range accepts a real remote-tracking merge with its default Git title', (t) => {
  const f = prepareMerge(t);
  f.git('commit', '--no-edit');
  const result = f.lint('--range', `${f.base}..HEAD`);
  assert.equal(result.status, 0, result.stderr);
});

test('file mode accepts the default remote-tracking title while a merge is active', (t) => {
  const f = prepareMerge(t);
  const mergeMessage = f.git('rev-parse', '--git-path', 'MERGE_MSG');
  const result = f.lint('--file', mergeMessage);
  assert.equal(result.status, 0, result.stderr);
});

test('a generated-looking title cannot bypass file checks outside a merge', (t) => {
  const f = fixture(t);
  for (const title of ["Merge branch 'pretend'", 'Merge pull request #123 from pretend/branch']) {
    writeFileSync(f.messageFile, `${title}\n`);
    const result = f.lint('--file', f.messageFile);
    assert.equal(result.status, 1, title);
    assert.match(result.stderr, /首行格式不对/);
  }
});

test('range checks reject a generated-looking title on a single-parent commit', (t) => {
  const f = fixture(t);
  f.git('commit', '--allow-empty', '-m', "Merge remote-tracking branch 'origin/main' into feature");
  const result = f.lint('--range', `${f.base}..HEAD`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /首行格式不对/);
});

test('a merge with a custom invalid title still fails both modes', (t) => {
  const f = prepareMerge(t);
  writeFileSync(f.messageFile, 'combined work\n');
  assert.equal(f.lint('--file', f.messageFile).status, 1);
  f.git('commit', '-F', f.messageFile);
  const result = f.lint('--range', `${f.base}..HEAD`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /combined work/);
});

test('valid merge metadata does not hide invalid ordinary commits in the range', (t) => {
  const f = prepareMerge(t, 'invalid upstream title');
  f.git('commit', '--no-edit');
  const result = f.lint('--range', `${f.base}..HEAD`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid upstream title/);
});

test('conventional root, ordinary and custom merge titles retain the same rules', (t) => {
  const f = prepareMerge(t);
  writeFileSync(f.messageFile, 'chore(git): 同步主分支\r\n\r\n# Git comment\r\n');
  assert.equal(f.lint('--file', f.messageFile).status, 0);
  f.git('commit', '-m', 'chore(git): 同步主分支');
  const result = f.lint('--range', 'HEAD');
  assert.equal(result.status, 0, result.stderr);
});

test('an invalid commit range reports an error rather than passing', (t) => {
  const f = fixture(t);
  const result = f.lint('--range', 'missing-base..HEAD');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /无法读取提交范围/);
});
