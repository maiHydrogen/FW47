import { createJiraTicket } from '../utils/jiraHelper.js';
import { markProcessed, getProcessedIds } from '../utils/storage.js';

/**
 * Pure classification of a pit stop's severity/summary, split out so the
 * webhook and the scheduled poller share one definition instead of two
 * copies drifting apart.
 */
export function classifyPitStop(driverNumber, lapNumber, pitDuration) {
  if (typeof pitDuration === 'number' && pitDuration > 3.5) {
    return {
      severity: 'High',
      summary: `⚠️ SLOW PIT STOP - Driver #${driverNumber} - ${pitDuration.toFixed(2)}s`
    };
  }
  if (typeof pitDuration === 'number' && pitDuration < 2.3) {
    return {
      severity: 'Low',
      summary: `✅ FAST PIT STOP - Driver #${driverNumber} - ${pitDuration.toFixed(2)}s`
    };
  }
  return {
    severity: 'Medium',
    summary: `Pit Stop - Driver #${driverNumber} - Lap ${lapNumber}`
  };
}

/**
 * Create (or skip, if already seen) a Jira ticket for one pit stop event.
 * Used by both the manual webhook and the scheduled poller.
 */
export async function processPitStopEvent({ session_key, driver_number, lap_number, pit_duration }) {
  const eventId = `pit-${session_key}-${driver_number}-${lap_number}`;
  const processedIds = await getProcessedIds();

  if (processedIds.includes(eventId)) {
    return { skipped: true, eventId };
  }

  const { severity, summary } = classifyPitStop(driver_number, lap_number, pit_duration);

  const ticket = await createJiraTicket({
    summary,
    description: `Pit stop detected on lap ${lap_number}.\nDuration: ${pit_duration.toFixed(2)}s\n\nSession: ${session_key}`,
    labels: [`driver-${driver_number}`, `session-${session_key}`, `lap-${lap_number}`, 'pitstop'],
    priority: severity
  });

  await markProcessed(eventId);

  return { skipped: false, ticket, eventId };
}
