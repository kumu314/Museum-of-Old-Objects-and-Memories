import type { Hunyuan3DErrorCode } from './types';

/**
 * Provider-boundary failure. The message is safe for a user-facing mapping;
 * provider responses, signed URLs and credentials must stay in the cause/log
 * layer and must not be serialized to clients.
 */
export class Hunyuan3DError extends Error {
  readonly code: Hunyuan3DErrorCode;
  readonly upstreamCode?: string;

  constructor(code: Hunyuan3DErrorCode, message: string, options?: ErrorOptions & { upstreamCode?: string }) {
    super(message, options);
    this.name = 'Hunyuan3DError';
    this.code = code;
    if (options?.upstreamCode !== undefined) this.upstreamCode = options.upstreamCode;
  }
}
