import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPitStop } from './pitProcessor.js';

test('classifyPitStop: slow pit stop (>3.5s) -> High severity', () => {
  const { severity, summary } = classifyPitStop(23, 15, 4.1);
  assert.equal(severity, 'High');
  assert.match(summary, /SLOW PIT STOP/);
  assert.match(summary, /#23/);
});

test('classifyPitStop: fast pit stop (<2.3s) -> Low severity', () => {
  const { severity, summary } = classifyPitStop(55, 20, 2.0);
  assert.equal(severity, 'Low');
  assert.match(summary, /FAST PIT STOP/);
});

test('classifyPitStop: normal-range duration -> Medium severity', () => {
  const { severity, summary } = classifyPitStop(23, 15, 2.8);
  assert.equal(severity, 'Medium');
  assert.match(summary, /Pit Stop - Driver #23 - Lap 15/);
});

test('classifyPitStop: non-numeric duration defaults to Medium without throwing', () => {
  const { severity } = classifyPitStop(23, 15, undefined);
  assert.equal(severity, 'Medium');
});
