import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getServerConfig } from '../src/server/config';
import { getPool } from '../src/server/db/pool';

/**
 * 孤儿素材巡检。默认只报告，不动磁盘；`--apply` 才删除。
 *
 * 「孤儿」= 上传目录下的 UUID 目录，且没有任何 assets / model_assets 记录引用它。
 * 这些目录来自：上传成功但事务未提交、进程在写文件与入库之间被中断、以及删除展品后
 * 未级联的文件。AGENTS 第 4 节要求首版不自动清理历史素材，所以本脚本不挂定时任务，
 * 由运维在确认备份可用后手动执行。
 *
 * 安全边界：
 * - 只处理文件名是规范 UUID 的**一级子目录**，其他文件/目录只报告不删除；
 * - 未引用但修改时间小于 `--min-age-hours`（默认 24）的目录视为可能仍在写入，跳过；
 * - 删除前重新查一次引用集合，避免扫描期间的入库被误删。
 */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const ageArgument = args.find((argument) => argument.startsWith('--min-age-hours='));
const minimumAgeHours = ageArgument === undefined ? 24 : Number(ageArgument.slice('--min-age-hours='.length));
if (!Number.isFinite(minimumAgeHours) || minimumAgeHours < 0) throw new Error('--min-age-hours must be a non-negative number.');
for (const argument of args) {
  if (argument !== '--apply' && !argument.startsWith('--min-age-hours=')) throw new Error('Usage: cleanup-orphan-assets.ts [--apply] [--min-age-hours=24]');
}

const pool = getPool();
const uploadDir = getServerConfig().uploadDir;

async function referencedIds(): Promise<Set<string>> {
  const result = await pool.query<{ id: string }>('SELECT id::text AS id FROM assets UNION SELECT id::text AS id FROM model_assets');
  return new Set(result.rows.map((row) => row.id));
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const info = await stat(join(directory, entry.name));
    total += info.size;
  }
  return total;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

let removed = 0;
let retained = 0;
let orphanBytes = 0;
try {
  const referenced = await referencedIds();
  const entries = await readdir(uploadDir, { withFileTypes: true });
  const unexpected = entries.filter((entry) => !entry.isDirectory() || !uuidPattern.test(entry.name));
  for (const entry of unexpected) {
    console.log(`未识别条目（只报告，不处理）：${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }

  const candidates = entries.filter((entry) => entry.isDirectory() && uuidPattern.test(entry.name)).map((entry) => entry.name);
  const scanned = await Promise.all(candidates.map(async (id) => {
    const directory = join(uploadDir, id);
    const [info, bytes] = await Promise.all([stat(directory), directorySize(directory)]);
    return { id, bytes, ageHours: (Date.now() - info.mtimeMs) / 3_600_000, referenced: referenced.has(id) };
  }));
  const orphans = scanned.filter((asset) => !asset.referenced);
  orphanBytes = orphans.reduce((total, asset) => total + asset.bytes, 0);

  const young = orphans.filter((asset) => asset.ageHours < minimumAgeHours);
  const deletable = orphans.filter((asset) => asset.ageHours >= minimumAgeHours);
  for (const asset of young) console.log(`跳过（修改时间不足 ${minimumAgeHours}h，可能仍在写入）：${asset.id}  ${megabytes(asset.bytes)}  ${asset.ageHours.toFixed(1)}h`);
  retained += young.length;

  if (!apply) {
    for (const asset of deletable) console.log(`孤儿（未删除，加 --apply 才删除）：${asset.id}  ${megabytes(asset.bytes)}  ${asset.ageHours.toFixed(1)}h`);
    retained += deletable.length;
  } else {
    // 扫描与删除之间可能已经完成入库：重新核对，只删仍然无引用的目录。
    const current = await referencedIds();
    for (const asset of deletable) {
      if (current.has(asset.id)) {
        retained += 1;
        console.log(`删除前复核发现已入库，保留：${asset.id}`);
        continue;
      }
      await rm(join(uploadDir, asset.id), { recursive: true, force: true });
      removed += 1;
      console.log(`已删除孤儿：${asset.id}  ${megabytes(asset.bytes)}  ${asset.ageHours.toFixed(1)}h`);
    }
  }

  console.log(JSON.stringify({ scanned: scanned.length, referenced: scanned.length - orphans.length, orphan: orphans.length,
    orphanBytes, removed, retained, applied: apply, minimumAgeHours }, null, 2));
} finally {
  await pool.end();
}
