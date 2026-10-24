import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameClock } from './frame-clock';

test('taking out and returning after demand-rendering idle each start with a fresh frame', () => {
  const clock = createFrameClock();
  assert.equal(clock.delta(100), 1 / 60);
  assert.equal(clock.delta(120), 0.02);
  clock.reset();
  assert.equal(clock.delta(1_120), 1 / 60);
  assert.equal(clock.delta(1_150), 0.03);
  clock.reset();
  assert.equal(clock.delta(61_150), 1 / 60);
});

test('a continuous low-frame-rate animation retains actual elapsed time', () => {
  const clock = createFrameClock();
  clock.delta(0);
  assert.equal(clock.delta(1_000), 1);
  assert.equal(clock.delta(3_500), 2.5);
});

test('reset after context loss discards the interrupted frame interval', () => {
  const clock = createFrameClock();
  clock.delta(500);
  clock.reset();
  clock.reset();
  assert.equal(clock.delta(20_500), 1 / 60);
  assert.equal(clock.delta(20_525), 0.025);
});
