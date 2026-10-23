export type AssetErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
} as const;

/**
 * Failure at the asset boundary. The message is safe to show to a user; the
 * cause is for server-side diagnosis and must not be returned by an API.
 */
export class AssetError extends Error {
  readonly code: AssetErrorCode;
  readonly status: (typeof STATUS_BY_CODE)[AssetErrorCode];

  constructor(code: AssetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssetError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
