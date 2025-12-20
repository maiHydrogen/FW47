import Resolver from '@forge/resolver';
import { 
  fetch2025Sessions, 
  fetchDriverInfo,
  fetchLapTelemetry,
  fetchLapInfo,
  fetchStintData,
  fetchPitStopData,
  fetchSessionInfo
} from './openf1.js';
import api, { route } from '@forge/api';

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
  try {
    const { sessionKey, driverNumber } = req.payload;
    
    // Fetch stints for this driver
    const stints = await fetchStintData(sessionKey, driverNumber);
    
    // Fetch all pit stops for comparison (both drivers)
    const allPitStops = [];
    for (const driver of [23, 55]) {
      const response = await api.fetch(
        `https://api.openf1.org/v1/pit?session_key=${sessionKey}&driver_number=${driver}`
      );
      const pits = await response.json();
      if (Array.isArray(pits)) {
        allPitStops.push(...pits);
      }
    }
    
    return {
      stints,
      allPitStops: allPitStops.sort((a, b) => a.lap_number - b.lap_number)
    };
    
  } catch (error) {
    console.error('Error fetching pit strategy:', error);
    return { stints: [], allPitStops: [] };
  }
});

// Get lap times with best lap for color coding
resolver.define('get-lap-times', async (req) => {
  try {
    const { sessionKey, driverNumber } = req.payload;
    
    console.log(`Fetching lap times for session=${sessionKey}, driver=${driverNumber}`);
    
    // Add timeout wrapper
    const fetchWithTimeout = async (url, timeoutMs = 8000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const response = await api.fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return response;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    };
    
    const response = await fetchWithTimeout(
      `https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
    );
    
    if (!response.ok) {
      console.error('Lap times API error:', response.status);
      return null;
    }
    
    const laps = await response.json();
    
    if (!Array.isArray(laps) || laps.length === 0) {
      console.log('No lap data found');
      return null;
    }
    
    console.log(`Found ${laps.length} laps`);
    
    // Find best lap
    const validLaps = laps.filter(l => l.lap_duration && !l.is_pit_out_lap);
    const bestLap = validLaps.length > 0 
      ? Math.min(...validLaps.map(l => l.lap_duration))
      : null;
    
    return {
      laps,
      bestLap
    };
    
  } catch (error) {
    console.error('Error fetching lap times:', error.message);
    // Return null instead of throwing - UI will show "No data"
    return null;
  }
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
