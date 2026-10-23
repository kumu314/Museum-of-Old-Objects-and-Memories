import { access, constants, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export async function verifyStorageDirectory(directory: string) {
  const target = await realpath(directory);
  let publicDirectory = resolve('public');
  try { publicDirectory = await realpath(publicDirectory); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const fromPublic = relative(publicDirectory, target);
  if (fromPublic !== '..' && !fromPublic.startsWith(`..${sep}`)) {
    throw new Error('Storage directory must be outside public');
  }
  if (!(await stat(target)).isDirectory()) throw new Error('Storage directory required');
  await access(target, constants.R_OK | constants.W_OK);
}
