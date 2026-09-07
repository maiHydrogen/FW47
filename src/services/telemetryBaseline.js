/**
 * Rolling per-driver telemetry baselines.
 *
 * The original anomaly rules compared telemetry against fixed constants
 * (e.g. "speed < 100"), which doesn't account for track type, session
 * conditions, or a specific driver's normal pace. These helpers build a
 * baseline from a driver's own recent laps so a "low speed" reading can be
 * judged against what's actually normal for them right now, not a
 * one-size-fits-all number.
 */

const DEFAULT_MIN_SAMPLES = 5;

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values, avg) {
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * @param {Array<{speed?: number, throttle?: number}>} telemetryPoints - raw
 *   points, e.g. from a few of a driver's previous laps.
 * @param {object} [options]
 * @param {number} [options.minSamples] - below this many valid points, the
 *   baseline is considered unreliable and null is returned instead.
 * @returns {{avgSpeed: number, stdSpeed: number, avgThrottle: number, stdThrottle: number, sampleSize: number}|null}
 */
export function buildTelemetryBaseline(telemetryPoints, { minSamples = DEFAULT_MIN_SAMPLES } = {}) {
  if (!Array.isArray(telemetryPoints)) return null;

  const valid = telemetryPoints.filter(
    (p) => p && typeof p.speed === 'number' && !Number.isNaN(p.speed) && typeof p.throttle === 'number' && !Number.isNaN(p.throttle)
  );

  if (valid.length < minSamples) return null;

  const speeds = valid.map((p) => p.speed);
  const throttles = valid.map((p) => p.throttle);
  const avgSpeed = mean(speeds);
  const avgThrottle = mean(throttles);

  return {
    avgSpeed,
    stdSpeed: stddev(speeds, avgSpeed),
    avgThrottle,
    stdThrottle: stddev(throttles, avgThrottle),
    sampleSize: valid.length
  };
}

/**
 * Collapse a lap's array of telemetry points into one snapshot, in the same
 * shape detectAnomalies() expects for a single-moment reading.
 */
export function summarizeTelemetryPoints(telemetryPoints) {
  if (!Array.isArray(telemetryPoints) || telemetryPoints.length === 0) return null;

  const avg = (key) => telemetryPoints.reduce((sum, p) => sum + (p[key] || 0), 0) / telemetryPoints.length;
  const max = (key) => Math.max(...telemetryPoints.map((p) => p[key] || 0));

  return {
    speed: avg('speed'),
    throttle: avg('throttle'),
    brake: max('brake'),
    rpm: avg('rpm'),
    n_gear: max('n_gear'),
    drs: max('drs')
  };
}
