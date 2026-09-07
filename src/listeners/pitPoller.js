import { fetchSessionPitStops } from '../resolvers/openf1.js';
import { processPitStopEvent } from '../services/pitProcessor.js';
import { TEAM_DRIVERS } from '../config/team.js';

// OpenF1 accepts 'latest' as a session_key to mean the most recently
// started session, so this always tracks whichever session is live.
const POLL_SESSION_KEY = 'latest';

/**
 * Scheduled entry point (see manifest.yml scheduledTrigger "poll-pit-stops").
 * Fetches the whole field's pit stops for the current session in one call,
 * filters down to our own drivers, and creates a ticket for any pit stop
 * not already processed (dedup handled inside processPitStopEvent).
 */
export async function pollPitStops() {
  console.log('[pitPoller] Polling latest pit stops...');

  try {
    const allPits = await fetchSessionPitStops(POLL_SESSION_KEY);
    const teamDriverNumbers = new Set(Object.keys(TEAM_DRIVERS).map(Number));
    const teamPits = allPits.filter((pit) => teamDriverNumbers.has(pit.driver_number));

    for (const pit of teamPits) {
      const result = await processPitStopEvent({
        session_key: pit.session_key,
        driver_number: pit.driver_number,
        lap_number: pit.lap_number,
        pit_duration: pit.pit_duration
      });

      if (!result.skipped) {
        console.log(`[pitPoller] Created ticket ${result.ticket.key} for pit event ${result.eventId}`);
      }
    }
  } catch (error) {
    console.error('[pitPoller] Error polling pit stops:', error);
  }
}
