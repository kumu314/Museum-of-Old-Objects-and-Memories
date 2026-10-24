const windowMs = 5 * 60 * 1000;
const limit = 10;
let startedAt: number | undefined;
let attempts = 0;

// A shared budget stops rotating unknown names from queuing unlimited scrypt work.
// No user-controlled names are retained; known accounts use their database budget.
export function allowUnknownLoginAttempt(): boolean {
  const now = Date.now();
  if (startedAt === undefined || now - startedAt >= windowMs) {
    startedAt = now;
    attempts = 0;
  }
  if (attempts >= limit) return false;
  attempts += 1;
  return true;
}
