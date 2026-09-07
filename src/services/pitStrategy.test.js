import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTireDegradationRisk, predictPitWindow, calculateLapTimeTrend } from './pitStrategy.js';

test('getTireDegradationRisk: unknown on missing/invalid tyreAge', () => {
  assert.equal(getTireDegradationRisk('SOFT', undefined), 'unknown');
  assert.equal(getTireDegradationRisk('SOFT', -1), 'unknown');
  assert.equal(getTireDegradationRisk('SOFT', NaN), 'unknown');
});

test('getTireDegradationRisk: SOFT degrades faster than HARD at the same lap count', () => {
  assert.equal(getTireDegradationRisk('SOFT', 22), 'critical');
  assert.equal(getTireDegradationRisk('HARD', 22), 'low');
});

test('getTireDegradationRisk: unknown compound falls back to MEDIUM window', () => {
  assert.equal(getTireDegradationRisk('PURPLE', 26), 'high');
  assert.equal(getTireDegradationRisk(undefined, 26), 'high');
});

test('predictPitWindow: fresh tyres -> low urgency', () => {
  const result = predictPitWindow({ compound: 'MEDIUM', tyreAge: 5 });
  assert.equal(result.urgency, 'low');
  assert.equal(result.risk, 'low');
});

test('predictPitWindow: tyres past max window -> high urgency, "PIT NOW"', () => {
  const result = predictPitWindow({ compound: 'SOFT', tyreAge: 21 });
  assert.equal(result.urgency, 'high');
  assert.match(result.recommendation, /PIT NOW/);
});

test('predictPitWindow: tyres in degradation zone -> medium urgency', () => {
  const result = predictPitWindow({ compound: 'MEDIUM', tyreAge: 28 });
  assert.equal(result.urgency, 'medium');
});

test('predictPitWindow: invalid tyreAge returns an "unknown" result instead of throwing', () => {
  const result = predictPitWindow({ compound: 'SOFT', tyreAge: null });
  assert.equal(result.risk, 'unknown');
  assert.equal(result.urgency, 'unknown');
});

test('predictPitWindow: strong negative lap-time trend escalates urgency ahead of the lap-count model', () => {
  const withoutTrend = predictPitWindow({ compound: 'MEDIUM', tyreAge: 10 });
  const withTrend = predictPitWindow({ compound: 'MEDIUM', tyreAge: 10, lapDeltaTrend: 0.8 });
  assert.equal(withoutTrend.urgency, 'low');
  assert.equal(withTrend.urgency, 'medium');
  assert.match(withTrend.recommendation, /trending/);
});

test('predictPitWindow: a small/negative lap-time trend does not affect urgency', () => {
  const result = predictPitWindow({ compound: 'MEDIUM', tyreAge: 10, lapDeltaTrend: -0.1 });
  assert.equal(result.urgency, 'low');
});

test('calculateLapTimeTrend: null on empty/invalid input', () => {
  assert.equal(calculateLapTimeTrend([]), null);
  assert.equal(calculateLapTimeTrend(null), null);
  assert.equal(calculateLapTimeTrend([{ is_pit_out_lap: true, lap_duration: 90 }]), null);
});

test('calculateLapTimeTrend: positive when recent laps are slower than best', () => {
  const laps = [
    { lap_duration: 90.0 },
    { lap_duration: 90.5 },
    { lap_duration: 91.2 },
    { lap_duration: 91.8 }
  ];
  const trend = calculateLapTimeTrend(laps, 3);
  // best = 90.0, recent 3 avg = (90.5+91.2+91.8)/3 = 91.166...
  assert.ok(trend > 1 && trend < 1.2);
});

test('calculateLapTimeTrend: excludes pit-out laps from best and recent window', () => {
  const laps = [
    { lap_duration: 90.0 },
    { lap_duration: 130.0, is_pit_out_lap: true },
    { lap_duration: 90.2 }
  ];
  const trend = calculateLapTimeTrend(laps, 3);
  assert.ok(trend < 1); // should not be skewed by the 130s out-lap
});
