import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTelemetryData, validatePitStrategy, validateLapTimes } from './index.js';

test('validateTelemetryData: rejects non-arrays, empty arrays, and null', () => {
  assert.equal(validateTelemetryData(null), null);
  assert.equal(validateTelemetryData(undefined), null);
  assert.equal(validateTelemetryData({ speed: 100 }), null);
  assert.equal(validateTelemetryData([]), null);
});

test('validateTelemetryData: filters out points missing required numeric fields', () => {
  const data = [
    { speed: 100, throttle: 50 },
    { speed: 'fast', throttle: 50 }, // invalid: speed not a number
    { throttle: 50 }, // invalid: missing speed
    null // invalid
  ];
  const result = validateTelemetryData(data);
  assert.equal(result.length, 1);
  assert.equal(result[0].speed, 100);
});

test('validateTelemetryData: returns null when nothing survives filtering', () => {
  assert.equal(validateTelemetryData([{ foo: 'bar' }]), null);
});

test('validatePitStrategy: null on non-object input', () => {
  assert.equal(validatePitStrategy(null), null);
  assert.equal(validatePitStrategy('nope'), null);
});

test('validatePitStrategy: defaults missing arrays to empty, null if both empty', () => {
  assert.equal(validatePitStrategy({}), null);
  assert.deepEqual(validatePitStrategy({ stints: [{}] }), { stints: [{}], allPitStops: [] });
});

test('validateLapTimes: null on missing/invalid laps array', () => {
  assert.equal(validateLapTimes(null), null);
  assert.equal(validateLapTimes({}), null);
  assert.equal(validateLapTimes({ laps: [] }), null);
});

test('validateLapTimes: passes through laps and normalizes bestLap', () => {
  const result = validateLapTimes({ laps: [{ lap_duration: 90 }], bestLap: '90' });
  assert.equal(result.laps.length, 1);
  assert.equal(result.bestLap, null); // '90' is a string, not a number -> null
});
