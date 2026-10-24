import { createHash, randomBytes } from 'node:crypto';
export function shareTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function newShareToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: shareTokenHash(token) };
}
