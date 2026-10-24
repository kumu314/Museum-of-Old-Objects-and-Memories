import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ProcessedAsset } from './process';

export interface PreparedAsset {
  id: string;
  kind: 'image' | 'audio';
  contentType: ProcessedAsset['contentType'];
  originalName: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  storageKey: string;
  thumbnailStorageKey: string | null;
}
const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:display\.(?:webp|mp3|m4a|wav)|thumbnail\.webp)$/;

/** Resolve only server-generated keys, after the route has authorized this asset. */
export function resolveAssetPath(uploadDir: string, storageKey: string): string {
  if (!isAbsolute(uploadDir) || !storageKeyPattern.test(storageKey)) throw new Error('Invalid private asset storage location.');
  return resolve(uploadDir, storageKey);
}
async function privateDirectory(uploadDir: string): Promise<string> {
  if (!isAbsolute(uploadDir)) throw new Error('Private storage requires an absolute directory.');
  const publicDirectory = resolve('public');
  let canonicalPublic = publicDirectory;
  try { canonicalPublic = await realpath(publicDirectory); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  // Check before mkdir too, so a rejected configuration cannot create a public directory.
  function outsidePublic(path: string): boolean {
    const fromPublic = relative(canonicalPublic, path);
    // On Windows, relative() returns an absolute path when the paths are on different drives.
    if (isAbsolute(fromPublic)) return true;
    return fromPublic === '..' || fromPublic.startsWith(`..${sep}`);
  }
  if (!outsidePublic(resolve(uploadDir))) throw new Error('Asset storage must be outside public.');
  await mkdir(uploadDir, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(uploadDir);
  if (!outsidePublic(canonicalRoot)) throw new Error('Asset storage must be outside public.');
  return canonicalRoot;
}

/** Complete private files before opening a DB transaction. No original image is retained. */
export async function prepareAsset(processed: ProcessedAsset, uploadDir: string): Promise<PreparedAsset> {
  const root = await privateDirectory(uploadDir);
  const id = randomUUID();
  const directory = resolve(root, id);
  await mkdir(directory, { mode: 0o700 });
  const extension = processed.kind === 'image' ? 'webp' : ({ 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav' } as const)[processed.contentType];
  const storageKey = `${id}/display.${extension}`;
  const thumbnailStorageKey = processed.kind === 'image' ? `${id}/thumbnail.webp` : null;
  try {
    await writeFile(resolveAssetPath(root, storageKey), processed.bytes, { flag: 'wx', mode: 0o600 });
    if (processed.kind === 'image' && thumbnailStorageKey !== null) {
      await writeFile(resolveAssetPath(root, thumbnailStorageKey), processed.thumbnailBytes, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    // No PreparedAsset escaped and no DB operation began; this directory belongs only to this call.
    try { await rm(directory, { recursive: true }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `Incomplete asset ${id} requires cleanup.`); }
    throw error;
  }
  return { id, kind: processed.kind, contentType: processed.contentType, originalName: processed.originalName,
    byteSize: processed.bytes.length, sha256: processed.sha256, storageKey, thumbnailStorageKey,
    width: processed.kind === 'image' ? processed.width : null, height: processed.kind === 'image' ? processed.height : null };
}

/**
 * 失败后能否删掉已经写好的私有文件。规则只有一条：**只有确定没提交才允许删**。
 *
 * - 事务根本没开始（回滚无需确认）→ 可删
 * - 事务回滚已被确认 → 可删
 * - COMMIT 已经发出但结果未知 → **不可删**：它可能已经提交，删了就把已入库素材的文件删掉了
 * - 提交成功但 HTTP 响应失败 → 根本不会走到清理分支；即便误判，COMMIT 标记也会挡住
 *
 * 宁可留下一个没人引用的孤儿文件，也不能删掉可能已被引用的文件。
 */
export function cleanupAllowed(state: { begun: boolean; commitAttempted: boolean; rollbackConfirmed: boolean }): boolean {
  return !state.commitAttempted && (!state.begun || state.rollbackConfirmed);
}

/**
 * Only call after a transaction is known not to have committed. Never call for an
 * uncertain COMMIT or a failed HTTP response. A failed reference lookup retains files.
 * The lookup must include asset rows and snapshot references, using this generated ID.
 */
export async function cleanupUncommittedAsset(
  prepared: PreparedAsset,
  uploadDir: string,
  transaction: 'not-started' | 'rolled-back',
  isReferenced: (assetId: string) => Promise<boolean>,
): Promise<boolean> {
  if (transaction !== 'not-started' && transaction !== 'rolled-back') throw new Error('Asset cleanup requires a definitively uncommitted transaction.');
  const root = await privateDirectory(uploadDir);
  const assetPath = resolveAssetPath(root, prepared.storageKey);
  if (prepared.storageKey.split('/')[0] !== prepared.id) throw new Error('Asset identity does not match its storage key.');
  if (await isReferenced(prepared.id)) return false;
  await rm(resolve(assetPath, '..'), { recursive: true, force: true });
  return true;
}
