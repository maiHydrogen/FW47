import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies } from './anomalyDetection.js';

test('detectAnomalies: no telemetry, no radio -> Low priority, no reasons', () => {
  const result = detectAnomalies({}, undefined);
  assert.equal(result.priority, 'Low');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.incidentType, null);
  assert.equal(result.confidence, 0.50);
});

test('detectAnomalies: emergency braking at high speed -> Critical', () => {
  const result = detectAnomalies({ brake: 100, speed: 300 });
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'emergency-braking');
  assert.match(result.reasoning, /Emergency braking/);
});

test('detectAnomalies: engine cutout while at speed -> Critical', () => {
  const result = detectAnomalies({ rpm: 0, speed: 150, throttle: 0 });
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'engine-stall');
});

test('detectAnomalies: neutral gear at high speed with engine running -> gearbox failure', () => {
  const result = detectAnomalies({ n_gear: 0, speed: 200, rpm: 8000 });
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'gearbox-failure');
});

test('detectAnomalies: DRS open under braking -> Critical safety issue', () => {
  const result = detectAnomalies({ drs: 12, brake: 100, speed: 100 });
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'drs-failure');
});

test('detectAnomalies: no throttle response at low speed with engine running -> High (power-unit)', () => {
  const result = detectAnomalies({ throttle: 0, speed: 30, rpm: 5000 });
  assert.equal(result.priority, 'High');
  assert.equal(result.incidentType, 'power-unit');
});

test('detectAnomalies: low speed + reduced throttle -> Medium (potential-issue)', () => {
  const result = detectAnomalies({ speed: 80, throttle: 20 });
  assert.equal(result.priority, 'Medium');
  assert.equal(result.incidentType, 'potential-issue');
});

test('detectAnomalies: normal green-flag telemetry -> Low, no false positive', () => {
  const result = detectAnomalies({ speed: 300, throttle: 100, brake: 0, rpm: 11000, n_gear: 8, drs: 12 });
  assert.equal(result.priority, 'Low');
  assert.deepEqual(result.reasons, []);
});

test('detectAnomalies: urgent radio keyword escalates a Low reading to High', () => {
  const result = detectAnomalies({ speed: 300, throttle: 100 }, "We've got a problem, box box");
  assert.equal(result.priority, 'High');
  assert.match(result.reasoning, /Urgent keywords/);
});

test('detectAnomalies: urgent radio keyword never downgrades an existing Critical', () => {
  const result = detectAnomalies({ brake: 100, speed: 300 }, 'box box box');
  assert.equal(result.priority, 'Critical');
});

test('detectAnomalies: malformed telemetry (non-numeric fields) does not throw and stays Low', () => {
  const result = detectAnomalies({ speed: 'fast', brake: 'on' }, null);
  assert.equal(result.priority, 'Low');
});

test('detectAnomalies: without a baseline, the flat potential-issue threshold still applies', () => {
  const result = detectAnomalies({ speed: 95, throttle: 20 });
  assert.equal(result.priority, 'Medium');
  assert.equal(result.incidentType, 'potential-issue');
});

test('detectAnomalies: a reliable baseline replaces the flat threshold - same speed, different verdict', () => {
  // 95 km/h would normally trip the flat "speed < 100" rule, but for a
  // driver whose own baseline average is only 100 km/h (e.g. a street
  // circuit or wet session), that's well within one std dev of normal.
  const calmBaseline = { avgSpeed: 100, stdSpeed: 10, sampleSize: 8 };
  const result = detectAnomalies({ speed: 95, throttle: 20 }, undefined, calmBaseline);
  assert.equal(result.priority, 'Low');
  assert.deepEqual(result.reasons, []);
});

test('detectAnomalies: a genuine pace drop vs. baseline is flagged even above the old flat threshold', () => {
  // 250 km/h would never trip the old flat "speed < 100" rule, but for a
  // driver whose baseline is 300 km/h +/- 10, it's a huge, real drop-off.
  const fastBaseline = { avgSpeed: 300, stdSpeed: 10, sampleSize: 6 };
  const result = detectAnomalies({ speed: 250, throttle: 60 }, undefined, fastBaseline);
  assert.equal(result.incidentType, 'potential-issue');
  assert.ok(result.priority === 'Medium' || result.priority === 'High');
  assert.match(result.reasoning, /std dev below/);
});

test('detectAnomalies: a large enough drop escalates to High', () => {
  const fastBaseline = { avgSpeed: 300, stdSpeed: 10, sampleSize: 6 };
  const result = detectAnomalies({ speed: 260, throttle: 60 }, undefined, fastBaseline); // -4 std dev
  assert.equal(result.priority, 'High');
});

test('detectAnomalies: a baseline with too few samples is ignored, falling back to the flat rule', () => {
  const thinBaseline = { avgSpeed: 300, stdSpeed: 5, sampleSize: 2 }; // below MIN_BASELINE_SAMPLES
  const result = detectAnomalies({ speed: 95, throttle: 20 }, undefined, thinBaseline);
  assert.equal(result.priority, 'Medium');
  assert.equal(result.incidentType, 'potential-issue');
  assert.doesNotMatch(result.reasoning, /std dev below/);
});

test('detectAnomalies: baseline never suppresses an absolute safety rule (emergency braking still Critical)', () => {
  const baseline = { avgSpeed: 100, stdSpeed: 5, sampleSize: 10 };
  const result = detectAnomalies({ brake: 100, speed: 300 }, undefined, baseline);
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'emergency-braking');
});

test('detectAnomalies: multiple simultaneous anomalies picks the highest-severity incidentType', () => {
  // Both emergency-braking (Critical) and potential-issue (Medium) style
  // conditions could overlap; Critical must win.
  const result = detectAnomalies({ brake: 100, speed: 300, throttle: 20 });
  assert.equal(result.priority, 'Critical');
  assert.equal(result.incidentType, 'emergency-braking');
});
