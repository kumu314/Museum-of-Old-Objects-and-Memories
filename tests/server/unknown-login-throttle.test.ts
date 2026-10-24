import assert from 'node:assert/strict';
import test from 'node:test';
import { allowUnknownLoginAttempt } from '../../src/server/auth/unknown-login-throttle';

test('未知账号共享有界哈希预算，并发不会越过限额，窗口到期恢复', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  let hashes = 0;
  await Promise.all(Array.from({ length: 100 }, async () => {
    if (!allowUnknownLoginAttempt()) return;
    await Promise.resolve();
    hashes += 1;
  }));
  assert.equal(hashes, 10);
  context.mock.timers.tick(5 * 60 * 1000 - 1);
  assert.equal(allowUnknownLoginAttempt(), false);
  context.mock.timers.tick(1);
  assert.equal(allowUnknownLoginAttempt(), true);
  for (let index = 0; index < 9; index += 1) assert.equal(allowUnknownLoginAttempt(), true);
  assert.equal(allowUnknownLoginAttempt(), false);
});
