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
const GENERATED_MERGE_HEADER = /^Merge (?:(?:remote-tracking )?branch(?:es)?|pull request|tag|commit)\s.+$/;

function checkOne(raw, isMerge = false) {
  const errors = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // 去掉注释行和尾部空行（git 的 COMMIT_EDITMSG 会带 # 注释）
  const content = lines.filter((l) => !l.startsWith('#')).join('\n').trim();
  if (!content) return ['提交信息为空'];

  const [header] = content.split('\n');

  // Git 自动生成的合并标题采用独立格式，且必须有真实合并元数据。
  if (isMerge && GENERATED_MERGE_HEADER.test(header)) return errors;

  const m = header.match(HEADER);
  if (!m) {
    errors.push(
      `首行格式不对：「${header}」\n` +
        `     应为 <type>: <做了什么>，type 只能是 ${TYPES.join(' / ')}`
    );
    return errors; // 格式都不对，后面的检查没意义
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

function rangeCommits(range) {
  const out = execFileSync('git', ['log', '--format=%P%x00%B%x00', range], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const fields = out.split('\0');
  const commits = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const parents = fields[i].trim().split(/\s+/).filter(Boolean);
    commits.push({ message: fields[i + 1].trim(), isMerge: parents.length > 1 });
  }
  return commits;
}

function mergeInProgress() {
  const mergeHeadPath = execFileSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], {
    encoding: 'utf8',
  }).trim();
  const mergeHeads = readFile(mergeHeadPath);
  return mergeHeads !== null && mergeHeads.trim().length > 0;
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
  const errs = checkOne(raw, mergeInProgress());
  if (errs.length) {
    failures++;
    console.error('\n✗ 提交信息没通过检查：\n');
    for (const e of errs) console.error(`   • ${e}`);
    console.error(
      '\n  格式：<type>: <做了什么>\n' +
        '  例：  feat: 登录页支持手机号验证码\n' +
        '        fix: 修复分页在第 2 页重复首条的问题\n\n' +
        '  请修正提交信息后重新提交。\n'
    );
    process.exit(1);
  }
  console.log('✓ 提交信息通过');
  process.exit(0);
}

if (range) {
  let commits;
  try {
    commits = rangeCommits(range);
  } catch (e) {
    console.error(`⚠ 无法读取提交范围 ${range}（${e.code || e.message}）`);
    process.exit(2);
  }
  for (const { message, isMerge } of commits) {
    const errs = checkOne(message, isMerge);
    if (errs.length) {
      failures++;
      console.error(`\n✗ ${message.split('\n')[0]}`);
      for (const e of errs) console.error(`   • ${e}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} 条提交信息不合格\n`);
    process.exit(1);
  }
  console.log(`✓ ${commits.length} 条提交信息全部通过`);
  process.exit(0);
}

console.error('用法：node scripts/lint-commit.mjs --file <path> | --range <base>..<head>');
process.exit(2);
