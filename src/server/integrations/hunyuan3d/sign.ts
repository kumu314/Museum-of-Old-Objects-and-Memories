import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'TC3-HMAC-SHA256';
const SERVICE = 'ai3d';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const SIGNED_HEADERS = 'content-type;host;x-tc-action';

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export type TencentSignInput = {
  secretId: string;
  secretKey: string;
  host: string;
  action: string;
  timestamp: string;
  body: string;
};

/**
 * Tencent Cloud API 3.0 TC3-HMAC-SHA256. The canonical request signs exactly
 * content-type, host and x-tc-action; the same body string must be sent.
 * Reference: https://cloud.tencent.com/document/api/213/30654
 */
export function buildAuthorization(input: TencentSignInput): string {
  const date = new Date(Number(input.timestamp) * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${input.host.toLowerCase()}\nx-tc-action:${input.action.toLowerCase()}\n`;
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${sha256Hex(input.body)}`;
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `${ALGORITHM}\n${input.timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = hmacSha256(`TC3${input.secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');
  return `${ALGORITHM} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`;
}

export { CONTENT_TYPE };
