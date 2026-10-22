/**
 * 暂存区检查（pre-commit 调用）
 *
 * 架构说明：git 调用全部放在 shell 钩子里，本脚本只读文件、只做文本分析。
 * 原因：Windows 上从 node 里 spawn git 偶发 EBUSY（实测），hook 一崩就挡住所有人。
 * 让 node 只干它擅长的事，风险最低。
 *
 * 用法（钩子自动调用，数据从管道进来）：
 *   sh .githooks/pre-commit
 * 手动跑（会自动调用 git，机器正常时可用）：
 *   node scripts/lint-staged.mjs
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_LINES = 500;
const MAX_BYTES = 1024 * 1024; // 1MB

const LOCK_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];
const GENERATED_DIRS = ['node_modules/', '.next/', 'dist/', 'build/', 'out/', '.turbo/', 'coverage/'];
const SENSITIVE = [
  /(^|\/)\.env(\.|$)/,
  /\.pem$/, /\.key$/, /\.p12$/,
  /(^|\/)data\/responses-real\.json$/,
  /(^|\/)data\/responses-raw\.csv$/,
  /(^|\/)\.workbuddy-ai\//,
  /(^|\/)\.agent\//,
];

/** 只在这些目录里拦调试残留——命令行工具本来就该打印东西 */
const CODE_DIRS = /^(app|lib|components|pages)\//;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ── 取数据 ────────────────────────────────────────────
/** 钩子通过管道喂数据，格式：
 *    @@SECTION numstat / @@SECTION sizes / @@SECTION diff
 *  用管道而不是临时文件：少一次写盘和清理，钩子就少一个卡死点。
 */
function parseSections(text) {
  const buf = { numstat: [], sizes: [], diff: [] };
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^@@SECTION (numstat|sizes|diff)$/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur) buf[cur].push(line);
  }
  return {
    numstat: buf.numstat.join('\n'),
    sizes: buf.sizes.join('\n'),
    diff: buf.diff.join('\n'),
  };
}

let numstat = '';
let diff = '';
let sizes = '';

// 根提交（仓库无任何提交，如重建历史）时全部文件都是"新增"，
// 巨型提交与空壳两类检查会误判——由钩子传 --root-commit 告知
const isRootCommit = process.argv.includes('--root-commit');

if (process.argv.includes('--stdin')) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  ({ numstat, diff, sizes } = parseSections(raw));
} else {
  // 手动跑：自己调 git（失败就放行，别把开发卡死）
  try {
    const g = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    numstat = g(['diff', '--cached', '--numstat']);
    diff = g(['diff', '--cached', '-U0', '--no-color']);
    const names = g(['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only'])
      .split('\n')
      .filter(Boolean);
    sizes = names
      .map((f) => {
        let s = 0;
        try {
          s = Number(g(['cat-file', '-s', `:${f}`]).trim());
        } catch {
          s = 0;
        }
        return `${s}\t${f}`;
      })
      .join('\n');
  } catch (e) {
    console.log(`\n⚠ 无法调用 git（${e.code || e.message}），跳过本地检查。CI 会再查一遍。\n`);
    process.exit(0);
  }
}

// ── 解析 ──────────────────────────────────────────────
const files = numstat
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [added, deleted, ...rest] = line.split('\t');
    return {
      path: rest.join('\t'),
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted),
      binary: added === '-',
    };
  });

const sizeMap = new Map(
  sizes
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [s, ...rest] = l.split('\t');
      return [rest.join('\t'), Number(s) || 0];
    })
);

/** 把 diff 按文件切块，记录每块的路径、是否新文件、新增行 */
function parseDiff(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      if (cur) out.push(cur);
      cur = { path: null, isNew: false, added: [] };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('new file mode')) {
      cur.isNew = true;
      continue;
    }
    if (raw.startsWith('+++ b/')) {
      cur.path = raw.slice(6);
      continue;
    }
    if (raw.startsWith('+++ /dev/null')) {
      cur.path = null; // 删除文件
      continue;
    }
    if (raw.startsWith('@@') || raw.startsWith('---') || raw.startsWith('+++')) continue;
    if (raw.startsWith('+') && cur.path) cur.added.push(raw.slice(1));
  }
  if (cur) out.push(cur);
  return out.filter((b) => b.path);
}

const blocks = parseDiff(diff);

if (files.length === 0) {
  console.log('（暂存区为空，跳过）');
  process.exit(0);
}

// ── 检查 ──────────────────────────────────────────────
const errors = [];
const warnings = [];

// 1. 敏感文件 / 生成物
for (const f of files) {
  if (SENSITIVE.some((re) => re.test(f.path))) {
    errors.push(
      `敏感文件不能提交：${f.path}\n` +
        `     真提交过就立刻换密钥——删文件不够，它已经在历史里了`
    );
  }
  if (GENERATED_DIRS.some((d) => f.path.startsWith(d) || f.path.includes('/' + d))) {
    errors.push(`生成物目录不该进仓库：${f.path}`);
  }
}

// 2. 大文件
for (const f of files) {
  const size = sizeMap.get(f.path) || 0;
  if (size > MAX_BYTES) {
    errors.push(
      `文件太大：${f.path}（${(size / 1024 / 1024).toFixed(1)}MB > 1MB）\n` +
        `     图片/视频/数据放网盘，仓库里只放代码和配置`
    );
  }
}

// 3. 巨型提交
// 只数**新增行**：删除行不算"改动量"。
// 清理类提交（删掉一整个文件）新增行是 0，但删除行可能上千——按「新增+删除」算
// 会把正常清理也拦下，反而逼人用 --no-verify，闸门就形同虚设。
let totalLines = 0;
let totalDeleted = 0;
const counted = [];
for (const f of files) {
  if (f.binary) continue;
  if (LOCK_FILES.some((l) => f.path.endsWith(l))) continue;
  if (GENERATED_DIRS.some((d) => f.path.includes(d))) continue;
  const n = f.added || 0;
  totalLines += n;
  totalDeleted += f.deleted || 0;
  counted.push({ path: f.path, n });
}
if (totalLines > MAX_LINES) {
  if (isRootCommit) {
    console.log(
      `（根提交：全部文件记为新增共 ${totalLines} 行，跳过 ${MAX_LINES} 行上限——` +
        `上限管的是"一次改太多"，根提交决定的是"从哪开始"）`
    );
  } else {
    const top = counted.sort((a, b) => b.n - a.n).slice(0, 3);
    errors.push(
      `本次新增 ${totalLines} 行，超过 ${MAX_LINES} 行上限\n` +
        `     最大的几个：${top.map((t) => `${t.path}(${t.n})`).join('、')}\n` +
        `     拆成几个提交——理由不是洁癖，是回滚时你只想撤一个`
    );
  }
}
// 大量删除只提示不拦：删除本身是合法的清理动作，但值得看一眼
if (totalDeleted > 2000) {
  warnings.push(`本次删除 ${totalDeleted} 行 —— 确认是清理，不是误删`);
}

// 4. 调试残留
let todoCount = 0;
for (const b of blocks) {
  for (const text of b.added) {
    if (/(\/\/|#|\/\*)\s*(TODO|FIXME|待实现|待补充)/.test(text)) todoCount++;
    if (!CODE_DIRS.test(b.path) || !CODE_EXT.test(b.path)) continue;
    if (/allow-console/.test(text)) continue;
    if (/\bdebugger\b/.test(text)) {
      errors.push(`调试残留（debugger）：${b.path}\n     ${text.trim().slice(0, 70)}`);
    } else if (/\bconsole\.(log|debug)\s*\(/.test(text)) {
      errors.push(
        `调试残留（console.log）：${b.path}\n     ${text.trim().slice(0, 70)}\n` +
          `     真要保留就加注释 // allow-console 说明原因`
      );
    }
  }
}

// 5. 空壳文件（新增文件里没有任何实质代码）
// 配置点文件跳过：.gitattributes 这类行首是 * 的文件会被上面的注释过滤器
// 整碗端走，误判成空壳（2026-10-23 根提交实测）
const CONFIG_DOTFILE = /(^|\/)\.[^/]+$/;
for (const b of blocks) {
  if (!b.isNew || b.added.length === 0) continue;
  if (CONFIG_DOTFILE.test(b.path)) continue;
  const meaningful = b.added
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(\/\/|\/\*|\*|#|<!--|-->)/.test(l))
    .filter((l) => !/^[})];?$/.test(l))
    .filter((l) => !/^(export\s*\{\s*\}\s*;?|export default \{\}\s*;?)$/.test(l));
  if (meaningful.length === 0) {
    errors.push(
      `空壳文件：${b.path}\n` +
        `     只有注释或 TODO，没有实际代码。等真写了再提交——\n` +
        `     空文件会被当成"已完成"，48 小时后变成没人记得的坑`
    );
  }
}

if (todoCount > 0) {
  warnings.push(`本次新增 ${todoCount} 处 TODO/FIXME —— 站会上过一遍，别留到比赛结束`);
}

// ── 输出 ──────────────────────────────────────────────
if (warnings.length) {
  console.log('');
  for (const w of warnings) console.log(`⚠ ${w}`);
}

if (errors.length) {
  console.error('\n✗ 提交被拦下：\n');
  for (const e of errors) console.error(`   • ${e}\n`);
  console.error('  确实要跳过：git commit --no-verify（用完在群里说一句）\n');
  process.exit(1);
}

console.log(`✓ 暂存区检查通过（${files.length} 个文件 / ${totalLines} 行）`);
