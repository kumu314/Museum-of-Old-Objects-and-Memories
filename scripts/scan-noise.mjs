/**
 * 全仓库噪声扫描（CI 用，也可本地跑）
 * 本地钩子能被 --no-verify 绕过，这一道绕不过。
 *
 * 用法：node scripts/scan-noise.mjs
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.workbuddy-ai', '.agent',
]);

const CODE_DIRS = new Set(['app', 'lib', 'components', 'pages']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MAX_BYTES = 1024 * 1024;

const errors = [];
const notes = [];
let codeFiles = 0;
let codeLines = 0;
let todoCount = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name));
      continue;
    }
    if (!e.isFile()) continue;
    const full = join(dir, e.name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');

    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }

    if (st.size > MAX_BYTES) {
      errors.push(`大文件：${rel}（${(st.size / 1024 / 1024).toFixed(1)}MB）`);
      continue;
    }

    if (/^\.env(\.|$)/.test(e.name)) {
      errors.push(`敏感文件在仓库里：${rel}`);
      continue;
    }

    const ext = extname(e.name);
    if (!CODE_EXT.has(ext)) continue;

    const top = rel.split('/')[0];
    if (!CODE_DIRS.has(top)) continue;

    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }

    codeFiles++;
    const lines = text.split('\n');
    codeLines += lines.length;

    lines.forEach((line, i) => {
      if (/(\/\/|#|\/\*)\s*(TODO|FIXME|待实现|待补充)/.test(line)) todoCount++;
      if (/allow-console/.test(line)) return;
      if (/\bdebugger\b/.test(line)) {
        errors.push(`调试残留（debugger）：${rel}:${i + 1}`);
      }
      if (/\bconsole\.(log|debug)\s*\(/.test(line)) {
        errors.push(`调试残留（console.log）：${rel}:${i + 1}  ${line.trim().slice(0, 60)}`);
      }
    });

    const meaningful = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^(\/\/|\/\*|\*|#|<!--|-->)/.test(l));
    if (meaningful.length === 0) {
      errors.push(`空壳文件：${rel}`);
    }
  }
}

walk(ROOT);

if (todoCount > 0) notes.push(`TODO/FIXME 共 ${todoCount} 处`);
notes.push(`代码文件 ${codeFiles} 个 / ${codeLines} 行（仅统计 app、lib、components、pages）`);

for (const n of notes) console.log(`· ${n}`);

if (errors.length) {
  console.error(`\n✗ 发现 ${errors.length} 处问题：\n`);
  for (const e of errors) console.error(`   • ${e}`);
  console.error('');
  process.exit(1);
}

console.log('\n✓ 未发现噪声');
