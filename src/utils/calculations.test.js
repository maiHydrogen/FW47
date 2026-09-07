import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSessionStats,
  calculateLapDelta,
  isCurrentStint,
  classifyPitStop,
  calculateConsistency,
  getTireDegradationRisk,
  getSpeedDistribution
} from './calculations.js';

test('calculateSessionStats: handles missing/malformed input without throwing', () => {
  assert.deepEqual(calculateSessionStats(undefined, undefined), {
    totalLaps: 0,
    validLaps: 0,
    avgLapTime: 'N/A',
    pitStops: 0
  });
  assert.deepEqual(calculateSessionStats({ laps: null }, { stints: null }), {
    totalLaps: 0,
    validLaps: 0,
    avgLapTime: 'N/A',
    pitStops: 0
  });
});

test('calculateSessionStats: computes averages excluding pit-out laps and invalid entries', () => {
  const lapTimes = {
    laps: [
      { lap_duration: 90, is_pit_out_lap: false },
      { lap_duration: 92, is_pit_out_lap: false },
      { lap_duration: 130, is_pit_out_lap: true }, // excluded
      { lap_duration: null, is_pit_out_lap: false }, // excluded
      { lap_duration: 'not-a-number', is_pit_out_lap: false } // excluded
    ]
  };
  const stats = calculateSessionStats(lapTimes, { stints: [{}, {}] });
  assert.equal(stats.totalLaps, 5);
  assert.equal(stats.validLaps, 2);
  assert.equal(stats.avgLapTime, '91.000');
  assert.equal(stats.pitStops, 1); // 2 stints = 1 pit stop
});

test('calculateLapDelta: null on missing/equal/non-numeric input', () => {
  assert.equal(calculateLapDelta(null, 90), null);
  assert.equal(calculateLapDelta(90, null), null);
  assert.equal(calculateLapDelta(90, 90), null);
  assert.equal(calculateLapDelta('90', 88), null);
});

test('calculateLapDelta: returns fixed-precision difference', () => {
  assert.equal(calculateLapDelta(91.234, 90.111), '1.123');
  assert.equal(calculateLapDelta(89.5, 90), '-0.500');
});

test('isCurrentStint: true only for the last index', () => {
  assert.equal(isCurrentStint(2, 3), true);
  assert.equal(isCurrentStint(1, 3), false);
});

test('classifyPitStop: fast/normal/slow thresholds', () => {
  assert.equal(classifyPitStop(2.0), 'fast');
  assert.equal(classifyPitStop(2.7), 'normal');
  assert.equal(classifyPitStop(3.5), 'slow');
  assert.equal(classifyPitStop(null), 'unknown');
  assert.equal(classifyPitStop('2.0'), 'unknown');
});

test('calculateConsistency: null on empty/invalid input', () => {
  assert.equal(calculateConsistency([], '90.000'), null);
  assert.equal(calculateConsistency(null, '90.000'), null);
  assert.equal(calculateConsistency([{ lap_duration: 90 }], 'N/A'), null);
});

test('calculateConsistency: standard deviation of valid laps', () => {
  const laps = [
    { lap_duration: 90 },
    { lap_duration: 92 },
    { lap_duration: 130, is_pit_out_lap: true } // excluded
  ];
  const result = calculateConsistency(laps, '91.000');
  assert.equal(Math.round(result * 100) / 100, 1); // stdev of [90,92] around 91 = 1
});

test('getTireDegradationRisk: risk bands', () => {
  assert.equal(getTireDegradationRisk(25), 'high');
  assert.equal(getTireDegradationRisk(18), 'medium');
  assert.equal(getTireDegradationRisk(5), 'low');
});

test('getSpeedDistribution: empty input returns all-zero distribution', () => {
  assert.deepEqual(getSpeedDistribution([]), { high: 0, medium: 0, low: 0 });
  assert.deepEqual(getSpeedDistribution(null), { high: 0, medium: 0, low: 0 });
});

test('getSpeedDistribution: buckets speeds correctly', () => {
  const points = [{ speed: 310 }, { speed: 250 }, { speed: 100 }, { speed: 50 }];
  const dist = getSpeedDistribution(points);
  assert.equal(dist.high, 25);
  assert.equal(dist.medium, 25);
  assert.equal(dist.low, 50);
});
