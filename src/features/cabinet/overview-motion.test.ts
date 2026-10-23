import assert from 'node:assert/strict';
import test from 'node:test';
import { overviewOffset } from './overview-motion.ts';

test('overview parallax stays within 3cm, including pointer coordinates outside the viewport', () => {
  assert.deepEqual(overviewOffset(0, 0, 'overview', false), [0, 0]);
  assert.deepEqual(overviewOffset(0.5, -0.5, 'overview', false), [0.015, -0.015]);
  assert.deepEqual(overviewOffset(3, -2, 'overview', false), [0.03, -0.03]);
});

test('parallax is disabled for reduced motion and every inspection transition', () => {
  for (const phase of ['overview', 'focusing', 'inspecting', 'returning'] as const) {
    assert.deepEqual(overviewOffset(1, 1, phase, true), [0, 0]);
    if (phase !== 'overview') assert.deepEqual(overviewOffset(1, -1, phase, false), [0, 0]);
  }
});
