import Resolver from '@forge/resolver';
import { 
  fetch2025Sessions, 
  fetchDriverInfo,
  fetchLapTelemetry,
  fetchLapInfo,
  fetchStintData,
  fetchPitStopData,
  fetchSessionPitStops,
  fetchSessionInfo
} from './openf1.js';
import api, { route } from '@forge/api';
import { handleRadioWebhook } from '../webhooks/radioWebhook';
import { handlePitWebhook } from '../webhooks/pitWebhook';
import { handler as rovoActionsHandler } from '../rovo/actions';
const resolver = new Resolver();

// Get all 2025 sessions
resolver.define('get-2025-sessions', async (req) => {
  try {
    const sessions = await fetch2025Sessions();
    console.log(`Fetched ${sessions.length} sessions from 2025`);
    return { sessions };
  } catch (error) {
    console.error('Error in get-2025-sessions:', error);
    return { sessions: [], error: error.message };
  }
});

// Get ticket context from labels and fields
resolver.define('get-ticket-context', async (req) => {
  try {
    const context = req.context;
    const issueKey = context.extension.issue.key;
    
    console.log('Loading ticket:', issueKey);
    
    // Fetch issue details
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      headers: { 'Accept': 'application/json' }
    });
    
    const issue = await response.json();
    const labels = issue.fields.labels || [];
    
    console.log('Ticket labels:', labels);
    console.log('Project:', issue.fields.project.key);
    
    // Check if it's a FW47 ticket
    if (issue.fields.project.key !== 'FW47') {
      throw new Error('This panel only works on FW47 project tickets');
    }
    
    // Extract driver number and session key from labels
    const driverLabel = labels.find(l => l.startsWith('driver-'));
    const sessionLabel = labels.find(l => l.startsWith('session-'));
    const lapLabel = labels.find(l => l.startsWith('lap-'));
    
    console.log('Driver label:', driverLabel);
    console.log('Session label:', sessionLabel);
    
    const driverNumber = driverLabel ? parseInt(driverLabel.replace('driver-', '')) : null;
    const sessionKey = sessionLabel ? parseInt(sessionLabel.replace('session-', '')) : null;
    const lapNumber = lapLabel ? parseInt(lapLabel.replace('lap-', '')) : null;
    
    if (!driverNumber || !sessionKey) {
      // Return a minimal context instead of throwing error
      return {
        driverNumber: null,
        driverName: 'Unknown Driver',
        sessionKey: null,
        sessionName: 'No Session Data',
        sessionType: 'N/A',
        location: 'N/A',
        lapNumber: null,
        issueKey,
        noData: true,
        message: 'This ticket does not have race operation labels (driver-XX, session-XXXX)'
      };
    }
    
    // Fetch driver info
    const driverInfo = await fetchDriverInfo(driverNumber);
    const sessionInfo = await fetchSessionInfo(sessionKey);
    
    return {
      driverNumber,
      driverName: driverInfo?.full_name || `Driver #${driverNumber}`,
      sessionKey,
      sessionName: sessionInfo?.session_name || 'Unknown',
      sessionType: sessionInfo?.session_type || 'Race',
      location: sessionInfo?.location || 'Unknown',
      lapNumber,
      issueKey,
      noData: false
    };
    
  } catch (error) {
    console.error('Error getting ticket context:', error);
    throw error;
  }
});


// Get telemetry data for specific lap
resolver.define('get-telemetry-data', async (req) => {
  try {
    const { sessionKey, driverNumber, lapNumber } = req.payload;
    
    if (!lapNumber) {
      return null;
    }
    
    const telemetry = await fetchLapTelemetry(sessionKey, driverNumber, lapNumber);
    return telemetry;
    
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return null;
  }
});

// Get pit strategy and comparisons
resolver.define('get-pit-strategy', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  
  // 1. Fetch current driver data AND all session pits
  const [stints, driverPits, allPits] = await Promise.all([
    fetchStintData(sessionKey, driverNumber),
    fetchPitStopData(sessionKey, driverNumber), // fetches single or array? Check implementation
    fetchSessionPitStops(sessionKey)
  ]);

  // Handle potential single object return from fetchPitStopData if logic was specific
  // But usually we want the LIST for history.
  // NOTE: Your fetchPitStopData currently returns a SINGLE object. 
  // For the strategy tab, you likely want the array history. 
  // Let's assume you update fetchPitStopData to return array, OR we use allPits to filter.
  
  const myPits = allPits.filter(p => p.driver_number === driverNumber);

  // 2. Filter out "Future" data (Time Travel Logic)
  let filteredStints = stints;
  let filteredDriverPits = myPits;

  if (lapNumber) {
    filteredStints = stints.filter(s => s.lap_start <= lapNumber);
    filteredDriverPits = myPits.filter(p => p.lap_number <= lapNumber);
  }

  return {
    stints: filteredStints,
    driverPitStops: filteredDriverPits, 
    allPitStops: allPits // Send full session data for "Average" calculation
  };
});
// Get lap times with best lap for color coding
resolver.define('get-lap-times', async (req) => {
  const { sessionKey, driverNumber, lapNumber } = req.payload;
  
  const response = await api.fetch(
    `https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
  );
  const allLaps = await response.json();

  if (!Array.isArray(allLaps)) return { laps: [], bestLap: null };

  // Filter out laps AFTER the incident
  const validLaps = lapNumber 
    ? allLaps.filter(l => l.lap_number <= lapNumber)
    : allLaps;

  // Recalculate best lap based on visible history only
  const bestLap = validLaps.reduce((min, p) => 
    p.lap_duration && p.lap_duration < min ? p.lap_duration : min, Infinity);

  return {
    laps: validLaps.sort((a, b) => b.lap_number - a.lap_number),
    bestLap: bestLap === Infinity ? null : bestLap
  };
});

// Legacy resolver for backward compatibility
resolver.define('get-session-tickets', async (req) => {
  try {
    const { sessionKey, driverNumber } = req.payload;
    
    let jql = 'project = FW47 ORDER BY created DESC';
    
    if (driverNumber) {
      jql = `project = FW47 AND labels = "driver-${driverNumber}" ORDER BY created DESC`;
    }
    
    console.log('Searching Jira with JQL:', jql);
    
    const response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql,
        fields: ['summary', 'labels', 'priority', 'status', 'created'],
        maxResults: 50
      })
    });
    
    console.log('Jira search response status:', response.status);
    const data = await response.json();
    
    const tickets = (data.values || []).map(issue => {
      const labels = issue.labels || [];
      const driverLabel = labels.find(l => l.startsWith('driver-'));
      const lapLabel = labels.find(l => l.startsWith('lap-'));
      
      return {
        key: issue.key,
        summary: issue.summary,
        driver_number: driverLabel ? parseInt(driverLabel.replace('driver-', '')) : null,
        lap_number: lapLabel ? parseInt(lapLabel.replace('lap-', '')) : null,
        priority: issue.priority?.name || 'Medium',
        status: issue.status?.name || 'To Do',
        created: issue.created
      };
    });
    
    console.log(`Found ${tickets.length} tickets`);
    return { tickets };
    
  } catch (error) {
    console.error('Error in get-session-tickets:', error);
    return { tickets: [] };
  }
});

export const handler = resolver.getDefinitions();
export { rovoActionsHandler, handleRadioWebhook, handlePitWebhook };