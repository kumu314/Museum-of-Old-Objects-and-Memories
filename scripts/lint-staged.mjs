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

const GENERATED_DIRS = ['node_modules/', '.next/', 'dist/', 'build/', 'out/', '.turbo/', 'coverage/', '.vite/', '.local/'];
const SENSITIVE = [
  /(^|\/)\.env(\.|$)/,
  /\.pem$/, /\.key$/, /\.p12$/,
  /(^|\/)data\/responses-real\.json$/,
  /(^|\/)data\/responses-raw\.csv$/,
  /(^|\/)\.workbuddy-ai\//,
  /(^|\/)\.agent\//,
];

/** 只在这些目录里拦调试残留——命令行工具本来就该打印东西 */
const CODE_DIRS = /^(src|app|lib|components|pages)\//;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ── 取数据 ────────────────────────────────────────────
/** 钩子通过管道喂数据，格式：
 *    @@SECTION numstat / @@SECTION diff
 *  用管道而不是临时文件：少一次写盘和清理，钩子就少一个卡死点。
 */
function parseSections(text) {
  const buf = { numstat: [], diff: [] };
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^@@SECTION (numstat|diff)$/);
    if (m) {
      cur = m[1];
      continue;
    }
    if (cur) buf[cur].push(line);
  }
  return {
    numstat: buf.numstat.join('\n'),
    diff: buf.diff.join('\n'),
  };
}

let numstat = '';
let diff = '';

if (process.argv.includes('--stdin')) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  ({ numstat, diff } = parseSections(raw));
} else {
  // 手动跑：自己调 git（失败就放行，别把开发卡死）
  try {
    const g = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    numstat = g(['diff', '--cached', '--numstat']);
    diff = g(['diff', '--cached', '-U0', '--no-color']);
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
    const [, , ...rest] = line.split('\t');
    return {
      path: rest.join('\t'),
    };
  });

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
  if (!/(^|\/)\.env\.example$/.test(f.path) && SENSITIVE.some((re) => re.test(f.path))) {
    errors.push(
      `敏感文件不能提交：${f.path}\n` +
        `     真提交过就立刻换密钥——删文件不够，它已经在历史里了`
    );
  }
  if (GENERATED_DIRS.some((d) => f.path.startsWith(d) || f.path.includes('/' + d))) {
    errors.push(`生成物目录不该进仓库：${f.path}`);
  }
}

// 2. 调试残留
let todoCount = 0;
for (const b of blocks) {
  for (const text of b.added) {
    if (/(\/\/|#|\/\*)\s*(TODO|FIXME|待实现|待补充)/.test(text)) todoCount++;
    if (!CODE_DIRS.test(b.path) || !CODE_EXT.test(b.path)) continue;
    if (b.path.startsWith('src/features/cabinet/assets/model-source/')) continue;
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

// 3. 空壳文件（新增文件里没有任何实质代码）
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
  warnings.push(`本次新增 ${todoCount} 处 TODO/FIXME`);
}

// ── 输出 ──────────────────────────────────────────────
if (warnings.length) {
  console.log('');
  for (const w of warnings) console.log(`⚠ ${w}`);
}

if (errors.length) {
  console.error('\n✗ 提交被拦下：\n');
  for (const e of errors) console.error(`   • ${e}\n`);
  process.exit(1);
}

console.log(`✓ 暂存区检查通过（${files.length} 个文件）`);
