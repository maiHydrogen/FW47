import { storage } from '@forge/api';
import { fetchTeamRadio, fetchDriverInfo, fetchTelemetryData } from '../resolvers/openf1';
import { createJiraTicket } from '../utils/jiraHelper';

const WILLIAMS_DRIVERS = [23, 55]; // Albon, Sainz
const SESSION_KEY = 'latest'; // Replace with specific Qatar GP session_key for demo

export async function pollRadioMessages() {
  console.log('Polling radio messages...');
  
  for (const driverNumber of WILLIAMS_DRIVERS) {
    try {
      const radios = await fetchTeamRadio(SESSION_KEY, driverNumber);
      const processedIds = await getProcessedRadioIds();
      
      for (const radio of radios) {
        const radioId = `${radio.session_key}_${radio.driver_number}_${radio.date}`;
        
        if (!processedIds.includes(radioId)) {
          await processRadioMessage(radio);
          await markRadioProcessed(radioId);
        }
      }
    } catch (error) {
      console.error(`Error polling radio for driver ${driverNumber}:`, error);
    }
  }
}

async function processRadioMessage(radio) {
  const driver = await fetchDriverInfo(radio.session_key, radio.driver_number);
  
  // Fetch telemetry at radio timestamp (approximate)
  const telemetryData = await fetchTelemetryData(radio.session_key, radio.driver_number);
  const telemetry = findClosestTelemetry(telemetryData, radio.date);
  
  const description = formatRadioDescription(radio, telemetry);
  const labels = calculateLabels(radio, telemetry);
  
  await createJiraTicket({
    summary: `${driver.broadcast_name} - Radio ${new Date(radio.date).toLocaleTimeString()}`,
    description,
    labels,
    priority: 'Medium' // Rovo can update this
  });
}

function formatRadioDescription(radio, telemetry) {
  return `**Radio Timestamp:** ${radio.date}
**Audio:** [Listen to Radio](${radio.recording_url})

**Telemetry Snapshot:**
- Speed: ${telemetry?.speed || 'N/A'} km/h
- RPM: ${telemetry?.rpm || 'N/A'}
- Throttle: ${telemetry?.throttle || 'N/A'}%
- Brake: ${telemetry?.brake === 100 ? 'APPLIED' : 'OFF'}
- Gear: ${telemetry?.n_gear || 'N/A'}
- DRS: ${getDRSStatus(telemetry?.drs)}

**Action Required:** Analyze radio message and classify incident.`;
}

function calculateLabels(radio, telemetry) {
  const labels = ['radio-message', `driver-${radio.driver_number}`];
  
  if (telemetry?.brake === 100 && telemetry?.speed > 250) {
    labels.push('emergency-braking', 'high-priority');
  }
  
  if (telemetry?.speed < 100 && telemetry?.throttle < 30) {
    labels.push('potential-issue');
  }
  
  return labels;
}

function findClosestTelemetry(telemetryData, targetDate) {
  if (!telemetryData || telemetryData.length === 0) return null;
  
  const targetTime = new Date(targetDate).getTime();
  return telemetryData.reduce((closest, current) => {
    const currentDiff = Math.abs(new Date(current.date).getTime() - targetTime);
    const closestDiff = Math.abs(new Date(closest.date).getTime() - targetTime);
    return currentDiff < closestDiff ? current : closest;
  });
}

function getDRSStatus(drsValue) {
  const drsMap = {
    0: 'OFF', 1: 'OFF', 8: 'Eligible', 10: 'ON', 12: 'ON', 14: 'ON'
  };
  return drsMap[drsValue] || 'Unknown';
}

async function getProcessedRadioIds() {
  const stored = await storage.get('processedRadioIds');
  return stored || [];
}

async function markRadioProcessed(radioId) {
  const processedIds = await getProcessedRadioIds();
  processedIds.push(radioId);
  await storage.set('processedRadioIds', processedIds);
}
