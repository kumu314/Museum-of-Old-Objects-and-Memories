export type CurationSegment = {
  /** Stable identifier from the saved narrative version, e.g. "S1". */
  id: string;
  text: string;
};

export type CurationInput = {
  /** Version the caller read before starting the request. */
  sourceVersion: string;
  exhibitName: string;
  era: string;
  segments: readonly CurationSegment[];
};

export type CurationDraft = {
  sourceVersion: string;
  label: string;
  questions: readonly string[];
  sourceSegmentIds: readonly string[];
  model: string;
  generatedAt: string;
};

export type CurationServiceConfig = {
  apiKey: string;
  model: string;
  /** OpenAI-compatible base URL, normally ending in /v1. */
  baseUrl?: string;
  timeoutMs?: number;
  maxInputChars?: number;
  /** Some OpenAI-compatible providers do not implement response_format. */
  jsonMode?: boolean;
};

export type CurationService = {
  generateDraft(input: CurationInput): Promise<CurationDraft>;
};

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_INPUT_CHARS = 6_000;
export const MIN_LABEL_CHARS = 60;
export const MAX_LABEL_CHARS = 120;
export const MAX_QUESTIONS = 2;
export const MAX_QUESTION_CHARS = 80;
export const MAX_SEGMENTS = 20;
