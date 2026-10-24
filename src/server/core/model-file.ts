import { readFile } from 'node:fs/promises';
import { resolveAssetPath } from '../assets/storage';
import { getServerConfig } from '../config';
import { HttpError, privateHeaders } from '../http';
import { shareNotFoundMessage } from '../../contracts';

export async function sharedModelFileResponse(stored: { storage_key: string }): Promise<Response> {
  let bytes: Buffer;
  try { bytes = await readFile(resolveAssetPath(getServerConfig().uploadDir, stored.storage_key)); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new HttpError({ code: 'SHARE_NOT_FOUND', message: shareNotFoundMessage });
    }
    throw error;
  }
  return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders,
    'Content-Type': 'model/gltf-binary', 'Content-Length': String(bytes.length),
  } });
}
