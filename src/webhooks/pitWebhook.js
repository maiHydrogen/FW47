import { processPitStopEvent } from '../services/pitProcessor.js';

export async function handlePitWebhook(req) {
  try {
    const payload = req.body;
    console.log('Pit stop webhook triggered:', payload);

    const { session_key, driver_number, lap_number, pit_duration } = payload;

    const result = await processPitStopEvent({ session_key, driver_number, lap_number, pit_duration });

    if (result.skipped) {
      console.log(`[DUPLICATE] Event ${result.eventId} already processed. Skipping.`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Duplicate event ignored' })
      };
    }

    console.log(`[SUCCESS] Created ticket ${result.ticket.key} for event ${result.eventId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticket: result.ticket.key,
        eventId: result.eventId
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
