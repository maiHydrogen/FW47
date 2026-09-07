import { fetchTeamRadio } from '../resolvers/openf1.js';
import { processRadioMessage } from '../services/radioProcessor.js';
import { markProcessed, getProcessedIds } from '../utils/storage.js';
import { TEAM_DRIVERS } from '../config/team.js';

// OpenF1 accepts 'latest' as a session_key to mean the most recently
// started session, so this always tracks whichever session is live.
const POLL_SESSION_KEY = 'latest';

/**
 * Scheduled entry point (see manifest.yml scheduledTrigger "poll-radio-messages").
 * Checks each of our drivers' most recent team radio message and, if it
 * hasn't been turned into a ticket yet, processes it exactly like the
 * manual radio webhook does.
 */
export async function pollRadioMessages() {
  console.log('[radioPoller] Polling latest team radio messages...');
  const processedIds = await getProcessedIds();

  for (const driverNumber of Object.keys(TEAM_DRIVERS).map(Number)) {
    try {
      const radios = await fetchTeamRadio(POLL_SESSION_KEY, driverNumber);
      if (!radios || radios.length === 0) continue;

      const latestRadio = radios[radios.length - 1];
      const eventId = `radio-${latestRadio.session_key}-${driverNumber}-${latestRadio.date}`;

      if (processedIds.includes(eventId)) continue;

      console.log(`[radioPoller] New radio for driver ${driverNumber} at ${latestRadio.date}`);
      await processRadioMessage(latestRadio, latestRadio.session_key);
      await markProcessed(eventId);
    } catch (error) {
      console.error(`[radioPoller] Error polling driver ${driverNumber}:`, error);
    }
  }
}
