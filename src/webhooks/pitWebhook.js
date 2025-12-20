import api, { route, storage } from '@forge/api';
import { createJiraTicket } from '../utils/jiraHelper.js';
import { markProcessed, getProcessedIds } from '../utils/storage.js';

export async function handlePitWebhook(req) {
  try {
    const payload = req.body;
    console.log('Pit stop webhook triggered:', payload);
    
    const { session_key, driver_number, lap_number, pit_duration } = payload;
    
    // 🔥 NEW: Prevent duplicate tickets
    const eventId = `pit-${session_key}-${driver_number}-${lap_number}`;
    const processedIds = await getProcessedIds();
    
    if (processedIds.includes(eventId)) {
      console.log(`[DUPLICATE] Event ${eventId} already processed. Skipping.`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Duplicate event ignored' })
      };
    }
    
    // Classify pit stop
    let severity = 'Medium';
    let summary = `Pit Stop - Driver #${driver_number} - Lap ${lap_number}`;
    
    if (pit_duration > 3.5) {
      severity = 'High';
      summary = `⚠️ SLOW PIT STOP - Driver #${driver_number} - ${pit_duration.toFixed(2)}s`;
    } else if (pit_duration < 2.3) {
      severity = 'Low';
      summary = `✅ FAST PIT STOP - Driver #${driver_number} - ${pit_duration.toFixed(2)}s`;
    }
    
    // Create ticket
    const ticket = await createJiraTicket({
      summary,
      description: `Pit stop detected on lap ${lap_number}.\nDuration: ${pit_duration.toFixed(2)}s\n\nSession: ${session_key}`,
      labels: [`driver-${driver_number}`, `session-${session_key}`, `lap-${lap_number}`, 'pitstop'],
      priority: severity
    });
    
    // 🔥 NEW: Mark as processed
    await markProcessed(eventId);
    console.log(`[SUCCESS] Created ticket ${ticket.key} for event ${eventId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        ticket: ticket.key,
        eventId 
      })
    };
    
  } catch (error) {
    console.error('Pit webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
