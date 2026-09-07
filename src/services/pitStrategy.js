/**
 * Pit stop strategy prediction.
 *
 * Rule-based, not a fitted ML degradation model - the compound windows
 * below are heuristic estimates grounded in typical F1 tyre behavior
 * (soft compounds degrade fastest, hard compounds last longest). Treat
 * this as a reasonable starting recommendation for a race engineer to
 * sanity-check, not a lap-precise prediction.
 */

// Approximate optimal stint length windows, in laps, per compound.
const COMPOUND_WINDOWS = {
  SOFT: { min: 10, optimal: 15, max: 20 },
  MEDIUM: { min: 18, optimal: 26, max: 32 },
  HARD: { min: 28, optimal: 36, max: 42 },
  INTERMEDIATE: { min: 12, optimal: 20, max: 28 },
  WET: { min: 10, optimal: 16, max: 22 }
};

const DEFAULT_WINDOW = COMPOUND_WINDOWS.MEDIUM;

function getCompoundWindow(compound) {
  const key = typeof compound === 'string' ? compound.toUpperCase() : '';
  return COMPOUND_WINDOWS[key] || DEFAULT_WINDOW;
}

/**
 * Compound-aware degradation risk, replacing the flat lap-count thresholds
 * in utils/calculations.js (which don't account for compound at all).
 */
export function getTireDegradationRisk(compound, tyreAge) {
  if (typeof tyreAge !== 'number' || Number.isNaN(tyreAge) || tyreAge < 0) return 'unknown';

  const window = getCompoundWindow(compound);
  if (tyreAge >= window.max) return 'critical';
  if (tyreAge >= window.optimal) return 'high';
  if (tyreAge >= window.min) return 'medium';
  return 'low';
}

/**
 * Recommend a pit window for the current stint.
 *
 * @param {object} params
 * @param {string} params.compound - current tyre compound
 * @param {number} params.tyreAge - laps completed on this set of tyres
 * @param {number} [params.lapDeltaTrend] - seconds/lap the driver has
 *   slowed over the last few laps vs. their best (from calculateLapTimeTrend).
 *   Optional secondary signal so a stint that's degrading faster than the
 *   generic model expects still gets flagged.
 */
export function predictPitWindow({ compound, tyreAge, lapDeltaTrend }) {
  if (typeof tyreAge !== 'number' || Number.isNaN(tyreAge) || tyreAge < 0) {
    return {
      compound: compound || 'UNKNOWN',
      tyreAge: null,
      risk: 'unknown',
      urgency: 'unknown',
      recommendation: 'Insufficient data to predict a pit window.'
    };
  }

  const window = getCompoundWindow(compound);
  const risk = getTireDegradationRisk(compound, tyreAge);

  const lapsUntilWindowOpens = Math.max(window.min - tyreAge, 0);
  const lapsUntilWindowCloses = Math.max(window.max - tyreAge, 0);

  let urgency = 'low';
  let recommendation = `On track - tyres within the normal window for ${compound || 'the current'} compound.`;

  if (risk === 'critical') {
    urgency = 'high';
    recommendation = `PIT NOW - tyre age (${tyreAge} laps) is past the expected window for ${compound} (${window.min}-${window.max} laps). Significant pace loss likely.`;
  } else if (risk === 'high') {
    urgency = 'medium';
    recommendation = `Pit window is open - lap ${tyreAge} of a typical ${window.min}-${window.max} lap ${compound} stint.`;
  } else if (risk === 'medium') {
    urgency = 'low';
    recommendation = `Pit window opens in ~${lapsUntilWindowOpens} lap(s) - monitor pace.`;
  }

  // Secondary signal: real lap-time degradation overrides the lap-count
  // model if the driver is losing more than ~0.3s/lap vs. their best.
  if (typeof lapDeltaTrend === 'number' && !Number.isNaN(lapDeltaTrend) && lapDeltaTrend > 0.3 && urgency !== 'high') {
    urgency = urgency === 'low' ? 'medium' : 'high';
    recommendation += ` Lap times are trending ${lapDeltaTrend.toFixed(2)}s/lap slower than best - degradation may be ahead of the model.`;
  }

  return {
    compound: compound || 'UNKNOWN',
    tyreAge,
    risk,
    urgency, // 'low' | 'medium' | 'high'
    windowMinLap: window.min,
    windowOptimalLap: window.optimal,
    windowMaxLap: window.max,
    lapsUntilWindowOpens,
    lapsUntilWindowCloses,
    recommendation
  };
}

/**
 * Simple lap-time degradation trend: how much slower (seconds/lap) the
 * most recent laps are versus the best lap seen. Positive = getting slower.
 */
export function calculateLapTimeTrend(laps, windowSize = 3) {
  if (!Array.isArray(laps) || laps.length === 0) return null;

  const validLaps = laps.filter((l) => l && typeof l.lap_duration === 'number' && !l.is_pit_out_lap);
  if (validLaps.length === 0) return null;

  const best = Math.min(...validLaps.map((l) => l.lap_duration));
  const recent = validLaps.slice(-windowSize);
  const avgRecent = recent.reduce((sum, l) => sum + l.lap_duration, 0) / recent.length;

  return avgRecent - best;
}
