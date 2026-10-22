/**
 * Commit message 检查（零依赖）
 *
 * 用法：
 *   node scripts/lint-commit.mjs --file .git/COMMIT_EDITMSG
 *   node scripts/lint-commit.mjs --range origin/main..HEAD
 *
 * 设计取舍：只查"客观可判"的东西。查不出"这个提交有没有价值"——那要靠人。
 * 但能查出"这条 message 有没有信息量"，而这一条就足以挡掉大部分噪声。
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TYPES = [
  'feat', 'fix', 'docs', 'refactor', 'test',
  'chore', 'style', 'perf', 'build', 'ci', 'revert',
];

const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?: (\\S.*)$`);

/** 首行描述里出现这些词，等于没说改了什么 */
const VAGUE = [
  'update', 'updates', 'updated', 'change', 'changes', 'modify', 'modified',
  'wip', 'tmp', 'temp', 'test', 'fix', 'bugfix', 'misc', 'stuff',
  '修改', '改动', '提交', '更新', '优化', '调整', '完善', '一些小改', '小改',
  '改一下', '改了点', '杂项', '临时', '测试一下',
];

const MAX_HEADER = 72;

function checkOne(raw) {
  const errors = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // 去掉注释行和尾部空行（git 的 COMMIT_EDITMSG 会带 # 注释）
  const content = lines.filter((l) => !l.startsWith('#')).join('\n').trim();
  if (!content) return ['提交信息为空'];

  const [header, ...rest] = content.split('\n');

  const m = header.match(HEADER);
  if (!m) {
    errors.push(
      `首行格式不对：「${header}」\n` +
        `     应为 <type>: <做了什么>，type 只能是 ${TYPES.join(' / ')}`
    );
    return errors; // 格式都不对，后面的检查没意义
  }

  const desc = m[3].trim();

  if (header.length > MAX_HEADER) {
    errors.push(`首行 ${header.length} 字，超过 ${MAX_HEADER}（超了说明你在写总结，不是在写提交信息）`);
  }

  if (desc.length < 4) {
    errors.push(`描述「${desc}」太短，看不出改了什么`);
  }

  const lower = desc.toLowerCase().replace(/[。.!！]+$/, '');
  if (VAGUE.includes(lower)) {
    errors.push(
      `描述「${desc}」是空泛词，等于没说改了什么。\n` +
        `     换成「修好了什么」或「加了什么」，例：fix: 修复分页在第 2 页重复首条`
    );
  }

  if (/[。.]$/.test(desc)) {
    errors.push('描述结尾不要加句号');
  }

  // Generated-by 格式（可选，但写了就要写对）
  const body = rest.join('\n');
  const gen = body.match(/^\s*generated-by:\s*(.*)$/im);
  if (gen && !gen[1].trim()) {
    errors.push('写了 Generated-by: 但没写工具名');
  }

  return errors;
}

function readFile(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function rangeMessages(range) {
  const out = execFileSync('git', ['log', '--format=%B%x00', range], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return out.split('\0').map((s) => s.trim()).filter(Boolean);
}

const args = process.argv.slice(2);
const getArg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};

const file = getArg('--file');
const range = getArg('--range');

let failures = 0;

if (file) {
  const raw = readFile(file);
  if (raw === null) {
    console.error(`读不到 ${file}`);
    process.exit(2);
  }
  // 合并提交 / revert 自动放行
  if (/^Merge (branch|pull request)/.test(raw.trim())) process.exit(0);

  const errs = checkOne(raw);
  if (errs.length) {
    failures++;
    console.error('\n✗ 提交信息没通过检查：\n');
    for (const e of errs) console.error(`   • ${e}`);
    console.error(
      '\n  格式：<type>: <做了什么>\n' +
        '  例：  feat: 登录页支持手机号验证码\n' +
        '        fix: 修复分页在第 2 页重复首条的问题\n\n' +
        '  确实要跳过：git commit --no-verify（用完在群里说一句）\n'
    );
    process.exit(1);
  }
  console.log('✓ 提交信息通过');
  process.exit(0);
}

if (range) {
  let msgs;
  try {
    msgs = rangeMessages(range);
  } catch (e) {
    console.error(`⚠ 无法读取提交范围 ${range}（${e.code || e.message}）`);
    process.exit(2);
  }
  for (const msg of msgs) {
    const errs = checkOne(msg);
    if (errs.length) {
      failures++;
      console.error(`\n✗ ${msg.split('\n')[0]}`);
      for (const e of errs) console.error(`   • ${e}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} 条提交信息不合格\n`);
    process.exit(1);
  }
  console.log(`✓ ${msgs.length} 条提交信息全部通过`);
  process.exit(0);
}

console.error('用法：node scripts/lint-commit.mjs --file <path> | --range <base>..<head>');
process.exit(2);
