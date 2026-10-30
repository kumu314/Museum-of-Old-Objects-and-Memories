import { resolveAssetPath } from '../assets/storage';
import { privateFileResponse } from '../assets/file-response';
import { getServerConfig } from '../config';
import { HttpError } from '../http';
import { shareNotFoundMessage } from '../../contracts';

export async function sharedModelFileResponse(stored: { storage_key: string }, request: Request): Promise<Response> {
  return privateFileResponse({
    request,
    path: resolveAssetPath(getServerConfig().uploadDir, stored.storage_key),
    contentType: 'model/gltf-binary',
    onMissing: () => { throw new HttpError({ code: 'SHARE_NOT_FOUND', message: shareNotFoundMessage }); },
  });
}
