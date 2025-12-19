import Resolver from '@forge/resolver';
import { fetchTelemetryData, fetchStintData, fetchPitStops } from './openf1';

const resolver = new Resolver();

resolver.define('getTelemetryData', async (req) => {
  const { driverNumber } = req.payload;
  const sessionKey = 'latest'; // Use specific session_key for demo
  
  try {
    const telemetry = await fetchTelemetryData(sessionKey, driverNumber);
    return telemetry[0] || null; // Return latest telemetry point
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return null;
  }
});

resolver.define('getStintData', async (req) => {
  const { driverNumber } = req.payload;
  const sessionKey = 'latest';
  
  try {
    return await fetchStintData(sessionKey, driverNumber);
  } catch (error) {
    console.error('Error fetching stints:', error);
    return [];
  }
});

resolver.define('getPitStopComparison', async (req) => {
  const { driverNumber } = req.payload;
  const sessionKey = 'latest';
  
  try {
    return await fetchPitStops(sessionKey, driverNumber);
  } catch (error) {
    console.error('Error fetching pit stops:', error);
    return [];
  }
});

export const handler = resolver.getDefinitions();
