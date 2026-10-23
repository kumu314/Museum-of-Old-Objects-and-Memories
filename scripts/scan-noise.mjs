/**
 * 全仓库噪声扫描（CI 用，也可本地跑）
 * 用法：node scripts/scan-noise.mjs
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';

const ROOT = process.cwd();
const CODE_DIRS = new Set(['src', 'app', 'lib', 'components', 'pages']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const errors = [];
const notes = [];
let codeFiles = 0;
let codeLines = 0;
let todoCount = 0;

function scan(rel) {
    const full = join(ROOT, rel);
    const name = basename(rel);
    if (/^\.env(\.|$)/.test(name) && name !== '.env.example') {
      errors.push(`敏感文件在仓库里：${rel}`);
      return;
    }

    // Offline asset-authoring CLI programs intentionally print build/validation reports.
    if (rel.startsWith('src/features/cabinet/assets/model-source/')) return;
    const ext = extname(name);
    if (!CODE_EXT.has(ext)) return;

    const top = rel.split('/')[0];
    if (!CODE_DIRS.has(top)) return;

    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch (error) {
      errors.push(`无法读取文件：${rel} (${error.code})`);
      return;
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

// Include tracked files even if ignored, but do not mistake private local config for committed content.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const deleted = new Set(execFileSync('git', ['ls-files', '--deleted', '-z'], { encoding: 'utf8' }).split('\0'));
for (const file of new Set(files)) {
  if (!deleted.has(file)) scan(file);
}

if (todoCount > 0) notes.push(`TODO/FIXME 共 ${todoCount} 处`);
notes.push(`代码文件 ${codeFiles} 个 / ${codeLines} 行（统计 src、app、lib、components、pages）`);

for (const n of notes) console.log(`· ${n}`);

if (errors.length) {
  console.error(`\n✗ 发现 ${errors.length} 处问题：\n`);
  for (const e of errors) console.error(`   • ${e}`);
  console.error('');
  process.exit(1);
}

console.log('\n✓ 未发现噪声');
