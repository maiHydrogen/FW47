import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTelemetryBaseline, summarizeTelemetryPoints } from './telemetryBaseline.js';

test('buildTelemetryBaseline: null when input is not an array', () => {
  assert.equal(buildTelemetryBaseline(null), null);
  assert.equal(buildTelemetryBaseline(undefined), null);
  assert.equal(buildTelemetryBaseline('nope'), null);
});

test('buildTelemetryBaseline: null when there are too few valid samples', () => {
  const points = [{ speed: 300, throttle: 100 }, { speed: 290, throttle: 95 }];
  assert.equal(buildTelemetryBaseline(points), null); // default minSamples=5
});

test('buildTelemetryBaseline: filters out points missing numeric speed/throttle', () => {
  const points = [
    { speed: 300, throttle: 100 },
    { speed: 290, throttle: 95 },
    { speed: 'fast', throttle: 90 }, // invalid
    { throttle: 80 }, // invalid, missing speed
    { speed: 310, throttle: 98 },
    { speed: 305, throttle: 99 },
    { speed: 295, throttle: 97 }
  ];
  const baseline = buildTelemetryBaseline(points);
  assert.equal(baseline.sampleSize, 5);
});

test('buildTelemetryBaseline: computes mean and stddev correctly', () => {
  const points = [
    { speed: 100, throttle: 50 },
    { speed: 100, throttle: 50 },
    { speed: 100, throttle: 50 },
    { speed: 100, throttle: 50 },
    { speed: 100, throttle: 50 }
  ];
  const baseline = buildTelemetryBaseline(points);
  assert.equal(baseline.avgSpeed, 100);
  assert.equal(baseline.stdSpeed, 0);
});

test('buildTelemetryBaseline: respects a custom minSamples', () => {
  const points = [{ speed: 300, throttle: 100 }, { speed: 290, throttle: 95 }];
  const baseline = buildTelemetryBaseline(points, { minSamples: 2 });
  assert.equal(baseline.sampleSize, 2);
});

test('summarizeTelemetryPoints: null on empty/invalid input', () => {
  assert.equal(summarizeTelemetryPoints([]), null);
  assert.equal(summarizeTelemetryPoints(null), null);
});

test('summarizeTelemetryPoints: averages continuous fields, maxes discrete/peak fields', () => {
  const points = [
    { speed: 200, throttle: 50, brake: 0, rpm: 10000, n_gear: 5, drs: 0 },
    { speed: 300, throttle: 100, brake: 100, rpm: 11000, n_gear: 7, drs: 12 },
    { speed: 250, throttle: 75, brake: 0, rpm: 10500, n_gear: 6, drs: 0 }
  ];
  const summary = summarizeTelemetryPoints(points);
  assert.equal(summary.speed, 250); // avg
  assert.equal(summary.throttle, 75); // avg
  assert.equal(summary.brake, 100); // max - any braking in the lap shows up
  assert.equal(summary.n_gear, 7); // max - highest gear reached
  assert.equal(summary.drs, 12); // max - DRS was opened at some point
});

test('summarizeTelemetryPoints: missing fields on individual points default to 0', () => {
  const points = [{ speed: 100 }, { speed: 200 }];
  const summary = summarizeTelemetryPoints(points);
  assert.equal(summary.speed, 150);
  assert.equal(summary.throttle, 0);
});
