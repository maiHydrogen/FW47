import { storage } from '@forge/api';

export async function getProcessedIds(key) {
  const stored = await storage.get(key);
  return stored || [];
}

export async function markProcessed(key, id) {
  const processedIds = await getProcessedIds(key);
  processedIds.push(id);
  await storage.set(key, processedIds);
}
