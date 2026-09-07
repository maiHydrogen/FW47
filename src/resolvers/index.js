import Resolver from '@forge/resolver';
import { 
  fetch2025Sessions, 
  fetchDriverInfo,
  fetchLapTelemetry,
  fetchLapInfo,
  fetchStintData,
  fetchPitStopData,
  fetchSessionInfo,
  fetchSessionPitStops
} from './openf1.js';
import api, { route } from '@forge/api';

// Imports from your other files
import { handleRadioWebhook } from '../webhooks/radioWebhook';
import { handlePitWebhook } from '../webhooks/pitWebhook';
import { handler as rovoActionsHandler } from '../rovo/actions';
import { predictPitWindow, calculateLapTimeTrend } from '../services/pitStrategy.js';
import { buildTelemetryBaseline, summarizeTelemetryPoints } from '../services/telemetryBaseline.js';
import { detectAnomalies } from '../services/anomalyDetection.js';

const resolver = new Resolver();

resolver.define('get-2025-sessions', async () => ({ sessions: await fetch2025Sessions() }));

resolver.define('get-ticket-context', async (req) => {
    try {
        const issueKey = req.context.extension.issue.key;
        const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
        const issue = await response.json();
        const labels = issue.fields.labels || [];
        
        // Robust Label Parsing using Regex
        const driverLabel = labels.find(l => l.match(/^driver-\d+$/));
        const sessionLabel = labels.find(l => l.match(/^session-\d+$/));
        const lapLabel = labels.find(l => l.match(/^lap-\d+$/));

        // Ensure base-10 parsing
        const driverNumber = driverLabel ? parseInt(driverLabel.split('-')[1], 10) : null;
        const sessionKey = sessionLabel ? parseInt(sessionLabel.split('-')[1], 10) : null;
        const lapNumber = lapLabel ? parseInt(lapLabel.split('-')[1], 10) : null;

        if (!driverNumber || !sessionKey) {
            return { noData: true, message: 'Missing labels (driver-XX, session-XXXX)' };
        }

        const [driverInfo, sessionInfo] = await Promise.all([
            fetchDriverInfo(driverNumber),
            fetchSessionInfo(sessionKey)
        ]);

        return {
            driverNumber,
            driverName: driverInfo?.full_name || `Driver #${driverNumber}`,
            headshotUrl: driverInfo?.headshot_url || null, // Image URL
            sessionKey,
            sessionName: sessionInfo?.session_name || 'Unknown',
            sessionType: sessionInfo?.session_type || 'Race',
            location: sessionInfo?.location || 'Unknown',
            lapNumber,
            issueKey,
            noData: false
        };
    } catch (e) {
        console.error(e);
        return { noData: true, message: e.message };
    }
});

resolver.define('get-telemetry-data', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  if (!lapNumber) return null;
  return await fetchLapTelemetry(sessionKey, driverNumber, lapNumber);
});

resolver.define('get-pit-strategy', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  
  const [stints, allPits] = await Promise.all([
    fetchStintData(sessionKey, driverNumber),
    fetchSessionPitStops(sessionKey)
  ]);

  // Filter "Future" data
  let filteredStints = stints;
  let filteredAllPits = allPits;

  if (lapNumber) {
    filteredStints = stints.filter(s => s.lap_start <= lapNumber);
    filteredAllPits = allPits.filter(p => p.lap_number <= lapNumber);
  }
  
  // Extract MY stops from ALL stops
  const driverPitStops = filteredAllPits.filter(p => p.driver_number === driverNumber);

  return {
    stints: filteredStints,
    driverPitStops: driverPitStops, // Specific driver history
    allPitStops: filteredAllPits    // Full field for avg calculation
  };
});

// Shared by get-lap-times and get-pit-prediction so both work from the
// same "laps up to this point" data instead of duplicating the fetch.
async function fetchLapsUpTo(sessionKey, driverNumber, lapNumber) {
  const response = await api.fetch(`https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
  const allLaps = await response.json();

  if (!Array.isArray(allLaps)) return [];
  return lapNumber ? allLaps.filter(l => l.lap_number <= lapNumber) : allLaps;
}

resolver.define('get-lap-times', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  const validLaps = await fetchLapsUpTo(sessionKey, driverNumber, lapNumber);

  const bestLap = validLaps.reduce((min, p) => p.lap_duration && p.lap_duration < min ? p.lap_duration : min, Infinity);

  return {
    laps: validLaps.sort((a, b) => b.lap_number - a.lap_number),
    bestLap: bestLap === Infinity ? null : bestLap
  };
});

resolver.define('get-pit-prediction', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;

  const [stints, laps] = await Promise.all([
    fetchStintData(sessionKey, driverNumber),
    fetchLapsUpTo(sessionKey, driverNumber, lapNumber)
  ]);

  const currentStints = lapNumber ? stints.filter(s => s.lap_start <= lapNumber) : stints;
  const currentStint = currentStints[currentStints.length - 1];

  if (!currentStint) {
    return { noData: true, message: 'No stint data available yet for this driver/session.' };
  }

  const referenceLap = lapNumber || currentStint.lap_end || currentStint.lap_start;
  const tyreAge = (currentStint.tyre_age_at_start || 0) + Math.max(referenceLap - currentStint.lap_start, 0);

  const lapDeltaTrend = calculateLapTimeTrend(laps, 3);

  return predictPitWindow({
    compound: currentStint.compound,
    tyreAge,
    lapDeltaTrend
  });
});

resolver.define('get-lap-anomaly-analysis', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;

  if (!lapNumber) {
    return { noData: true, message: 'No lap selected.' };
  }

  // Baseline is built from this driver's own previous 2 laps in this
  // session - compares "is this lap normal for them right now", not
  // against a fixed constant.
  const priorLapNumbers = [lapNumber - 2, lapNumber - 1].filter((n) => n > 0);

  const [currentLapPoints, ...priorLapsPoints] = await Promise.all([
    fetchLapTelemetry(sessionKey, driverNumber, lapNumber),
    ...priorLapNumbers.map((n) => fetchLapTelemetry(sessionKey, driverNumber, n))
  ]);

  const currentSnapshot = summarizeTelemetryPoints(currentLapPoints);
  if (!currentSnapshot) {
    return { noData: true, message: 'No telemetry available for this lap yet.' };
  }

  const baseline = buildTelemetryBaseline(priorLapsPoints.flat());
  const analysis = detectAnomalies(currentSnapshot, null, baseline);

  return {
    noData: false,
    baselineAvailable: !!baseline,
    baselineSampleSize: baseline?.sampleSize || 0,
    baselineLaps: priorLapNumbers,
    ...analysis
  };
});

export const handler = resolver.getDefinitions();
export { rovoActionsHandler, handleRadioWebhook, handlePitWebhook };