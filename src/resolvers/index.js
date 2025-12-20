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

resolver.define('get-lap-times', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  const response = await api.fetch(`https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
  const allLaps = await response.json();

  if (!Array.isArray(allLaps)) return { laps: [], bestLap: null };

  const validLaps = lapNumber ? allLaps.filter(l => l.lap_number <= lapNumber) : allLaps;
  const bestLap = validLaps.reduce((min, p) => p.lap_duration && p.lap_duration < min ? p.lap_duration : min, Infinity);

  return {
    laps: validLaps.sort((a, b) => b.lap_number - a.lap_number),
    bestLap: bestLap === Infinity ? null : bestLap
  };
});

export const handler = resolver.getDefinitions();
export { rovoActionsHandler, handleRadioWebhook, handlePitWebhook };