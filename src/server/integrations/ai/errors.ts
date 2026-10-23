export type AiErrorCode = "AI_TIMEOUT" | "AI_UNAVAILABLE";

/**
 * Failure at the model boundary. Callers map this to the shared error
 * contract; no narrative text, provider response, or credential belongs in
 * the message or cause.
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: 502 | 504;

  constructor(code: AiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiError";
    this.code = code;
    this.status = code === "AI_TIMEOUT" ? 504 : 502;
  }
}

/**
 * The caller passed data that cannot be curated. This is a request error,
 * not a provider failure, and maps to 400 VALIDATION_ERROR.
 */
export class CurationInputError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "CurationInputError";
  }
}
