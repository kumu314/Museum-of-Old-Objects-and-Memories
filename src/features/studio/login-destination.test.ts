import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginDestination } from './login-destination';

test('a valid share page can be resumed after login', () => {
  const path = `/share/${'a'.repeat(43)}`;
  assert.equal(loginDestination(path), path);
});

test('external, malformed and arbitrary return destinations use the personal studio', () => {
  for (const value of [undefined, null, ['share'], '', 'https://example.test', '//example.test',
    '/studio', '/share/invalid', `/share/${'a'.repeat(43)}?next=//example.test`,
    `/share/${'a'.repeat(43)}/extra`, `/share/${'a'.repeat(43)}#fragment`, '/share/../admin']) {
    assert.equal(loginDestination(value), '/studio');
  }
});
