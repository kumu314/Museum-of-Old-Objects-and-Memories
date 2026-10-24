import type { ErrorCode } from '../../contracts';

export class DemoRuleError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}
