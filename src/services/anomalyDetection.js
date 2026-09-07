/**
 * Telemetry anomaly detection.
 *
 * Pure, dependency-free rules over the fields OpenF1's car_data actually
 * provides (speed, rpm, throttle, brake, n_gear, drs). Kept separate from
 * rovo/actions.js so it can be unit tested without mocking @forge/api.
 */

const PRIORITY_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };

// Ordered roughly most- to least-severe; order only matters as a tiebreaker
// when multiple rules fire at the same priority (first match wins for
// `incidentType`).
const TELEMETRY_RULES = [
  {
    incidentType: 'emergency-braking',
    priority: 'Critical',
    test: (t) => t.brake === 100 && t.speed > 250,
    reason: 'Emergency braking at high speed (>250 km/h)'
  },
  {
    incidentType: 'engine-stall',
    priority: 'Critical',
    test: (t) => t.rpm === 0 && t.speed > 80,
    reason: 'Engine cutout detected while car still at speed (RPM=0)'
  },
  {
    incidentType: 'gearbox-failure',
    priority: 'Critical',
    test: (t) => t.n_gear === 0 && t.speed > 100 && t.rpm > 0,
    reason: 'Car in neutral at high speed with engine running - possible gearbox failure'
  },
  {
    incidentType: 'drs-failure',
    priority: 'Critical',
    test: (t) => t.drs > 10 && t.brake === 100,
    reason: 'DRS still open under braking - safety-critical DRS failure'
  },
  {
    incidentType: 'power-unit',
    priority: 'High',
    test: (t) => t.throttle === 0 && t.speed < 50 && t.rpm > 0,
    reason: 'Possible power unit issue - no throttle response'
  },
  {
    incidentType: 'potential-issue',
    priority: 'Medium',
    test: (t) => t.speed < 100 && t.throttle < 30,
    reason: 'Low speed with reduced throttle - potential issue'
  }
];

const URGENT_KEYWORDS = ['box', 'problem', 'damage', 'retire', 'issue', 'critical', 'broken'];

// A baseline needs at least this many valid samples before we trust it
// enough to replace the flat "potential-issue" threshold.
const MIN_BASELINE_SAMPLES = 5;
// How many standard deviations below the driver's own baseline speed
// counts as an anomaly at all, vs. how many counts as High rather than Medium.
const BASELINE_MEDIUM_Z = -2;
const BASELINE_HIGH_Z = -3;

/**
 * Guard against non-numeric/missing telemetry fields so rules can compare
 * with plain operators instead of every rule re-checking types.
 */
function normalizeTelemetry(telemetry) {
  const t = telemetry && typeof telemetry === 'object' ? telemetry : {};
  const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
  return {
    speed: num(t.speed),
    rpm: num(t.rpm),
    throttle: num(t.throttle),
    brake: num(t.brake),
    n_gear: num(t.n_gear),
    drs: num(t.drs)
  };
}

function higherPriority(a, b) {
  return PRIORITY_WEIGHT[a] >= PRIORITY_WEIGHT[b] ? a : b;
}

/**
 * @param {object} telemetryRaw - a telemetry snapshot (speed, rpm, throttle, brake, n_gear, drs)
 * @param {string} [radioMessage] - driver radio transcript, if any
 * @param {{avgSpeed: number, stdSpeed: number, sampleSize: number}} [baseline] -
 *   a driver's own recent-lap baseline (see services/telemetryBaseline.js).
 *   When present with enough samples, the flat "potential-issue" speed
 *   threshold is replaced by a comparison against this driver's own normal
 *   pace instead of a one-size-fits-all constant.
 * @returns {{priority: string, reasons: string[], reasoning: string, confidence: number, incidentType: string|null}}
 */
export function detectAnomalies(telemetryRaw, radioMessage, baseline) {
  const telemetry = normalizeTelemetry(telemetryRaw);
  const hasReliableBaseline = baseline && baseline.sampleSize >= MIN_BASELINE_SAMPLES;

  // When a reliable baseline exists, drop the flat "potential-issue" rule -
  // it's replaced below by a comparison against this driver's own pace.
  const rules = hasReliableBaseline
    ? TELEMETRY_RULES.filter((rule) => rule.incidentType !== 'potential-issue')
    : TELEMETRY_RULES;

  const matches = rules.filter((rule) => rule.test(telemetry));

  if (hasReliableBaseline && typeof telemetry.speed === 'number') {
    const speedZ = baseline.stdSpeed > 0 ? (telemetry.speed - baseline.avgSpeed) / baseline.stdSpeed : 0;
    if (speedZ <= BASELINE_MEDIUM_Z) {
      matches.push({
        incidentType: 'potential-issue',
        priority: speedZ <= BASELINE_HIGH_Z ? 'High' : 'Medium',
        reason: `Speed ${Math.round(telemetry.speed)} km/h is ${Math.abs(speedZ).toFixed(1)} std dev below this driver's own baseline (${Math.round(baseline.avgSpeed)} km/h avg over ${baseline.sampleSize} laps) - possible pace loss`
      });
    }
  }

  let priority = matches.length > 0
    ? matches.reduce((p, rule) => higherPriority(p, rule.priority), 'Low')
    : 'Low';

  const reasons = matches.map((rule) => rule.reason);
  // Highest-severity match among those that actually match `priority`.
  const incidentType = matches.find((rule) => rule.priority === priority)?.incidentType
    ?? matches[0]?.incidentType
    ?? null;

  if (radioMessage && typeof radioMessage === 'string') {
    const hasUrgentKeyword = URGENT_KEYWORDS.some((kw) => radioMessage.toLowerCase().includes(kw));
    if (hasUrgentKeyword) {
      priority = higherPriority(priority, 'High');
      reasons.push('Urgent keywords detected in radio message');
    }
  }

  return {
    priority,
    reasons,
    reasoning: reasons.join('; ') || 'No critical issues detected',
    confidence: reasons.length > 0 ? Math.min(0.85 + 0.03 * (reasons.length - 1), 0.95) : 0.50,
    incidentType
  };
}
