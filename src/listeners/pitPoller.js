import { storage } from '@forge/api';
import { fetchPitStops, fetchStintData, fetchDriverInfo } from '../resolvers/openf1';
import { createJiraTicket } from '../utils/jiraHelper';

const WILLIAMS_DRIVERS = [23, 55];
const SESSION_KEY = 'latest';

export async function pollPitStops() {
  console.log('Polling pit stops...');
  
  for (const driverNumber of WILLIAMS_DRIVERS) {
    try {
      const pits = await fetchPitStops(SESSION_KEY, driverNumber);
      const stints = await fetchStintData(SESSION_KEY, driverNumber);
      const processedIds = await getProcessedPitIds();
      
      for (const pit of pits) {
        const pitId = `${pit.session_key}_${pit.driver_number}_${pit.lap_number}`;
        
        if (!processedIds.includes(pitId)) {
          await processPitStop(pit, stints);
          await markPitProcessed(pitId);
        }
      }
    } catch (error) {
      console.error(`Error polling pits for driver ${driverNumber}:`, error);
    }
  }
}

async function processPitStop(pit, stints) {
  const driver = await fetchDriverInfo(pit.session_key, pit.driver_number);
  const currentStint = findStintForLap(stints, pit.lap_number);
  
  const description = formatPitDescription(pit, currentStint);
  
  await createJiraTicket({
    summary: `${driver.broadcast_name} - Pit Stop Lap ${pit.lap_number}`,
    description,
    labels: ['pit-stop', `driver-${pit.driver_number}`, `lap-${pit.lap_number}`],
    priority: 'Low'
  });
}

function formatPitDescription(pit, stint) {
  return `**Pit Stop Details:**
- Lap Number: ${pit.lap_number}
- Pit Duration: **${pit.pit_duration.toFixed(1)}s**
- Timestamp: ${pit.date}

**Tyre Strategy:**
- Compound: **${stint?.compound || 'Unknown'}**
- Tyre Age at Start: ${stint?.tyre_age_at_start || 'N/A'} laps
- Stint Number: ${stint?.stint_number || 'N/A'}

**Analysis:**
View the FW47 panel for stint comparison and pit time benchmarks.`;
}

function findStintForLap(stints, lapNumber) {
  return stints.find(s => s.lap_start <= lapNumber && s.lap_end >= lapNumber);
}

async function getProcessedPitIds() {
  const stored = await storage.get('processedPitIds');
  return stored || [];
}

async function markPitProcessed(pitId) {
  const processedIds = await getProcessedPitIds();
  processedIds.push(pitId);
  await storage.set('processedPitIds', processedIds);
}
