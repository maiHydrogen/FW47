import { storage } from '@forge/api';

// Single bucket tracking every incident/pit-stop event we've already
// turned into a Jira ticket, so webhook retries or duplicate polls
// don't create duplicate tickets.
const PROCESSED_EVENTS_KEY = 'fw47.processedEventIds';

// Cap the list so storage.app doesn't grow unbounded over a season.
const MAX_TRACKED_EVENTS = 500;

export async function getProcessedIds() {
  const stored = await storage.get(PROCESSED_EVENTS_KEY);
  return Array.isArray(stored) ? stored : [];
}

export async function markProcessed(id) {
  const processedIds = await getProcessedIds();
  if (processedIds.includes(id)) return;

  processedIds.push(id);
  // Keep only the most recent events to bound storage size.
  const trimmed = processedIds.slice(-MAX_TRACKED_EVENTS);
  await storage.set(PROCESSED_EVENTS_KEY, trimmed);
}
