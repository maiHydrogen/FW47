import { processRadioMessage } from '../services/radioProcessor';
import { fetchTeamRadio } from '../resolvers/openf1';

export async function handleRadioWebhook(req) {
  console.log('=== Manual Radio Trigger ===');
  
  // Parse the body if it's a string
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (error) {
    console.error('Failed to parse request body:', error);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Invalid JSON in request body'
      })
    };
  }
  
  const { session_key, driver_number, mode = 'latest' } = body;
  
  console.log(`Session: ${session_key}, Driver: ${driver_number}, Mode: ${mode}`);
  
  // Validate input
  if (!session_key || !driver_number) {
    console.error('Missing fields. Received body:', body);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Missing required fields: session_key and driver_number',
        receivedBody: body
      })
    };
  }
  
  try {
    // Fetch radio messages from OpenF1
    const radios = await fetchTeamRadio(session_key, driver_number);
    
    if (!radios || radios.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No radio messages found for this session/driver',
          session_key,
          driver_number,
          hint: 'Try a different session or driver number'
        })
      };
    }
    
    console.log(`Found ${radios.length} radio messages`);
    
    // For dev/demo: process latest radio only
    const radioToProcess = mode === 'latest' 
      ? radios[radios.length - 1]  // Most recent
      : radios[0];  // First one
    
    console.log(`Processing radio from ${radioToProcess.date}`);
    
    // Process the radio message
    const result = await processRadioMessage(radioToProcess, session_key);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketKey: result.ticketKey,
        ticketId: result.ticketId,
        radioDate: radioToProcess.date,
        recordingUrl: radioToProcess.recording_url || null,
        telemetryFetched: result.telemetryFetched,
        sessionInfo: result.sessionInfo,
        totalRadiosAvailable: radios.length
      })
    };
    
  } catch (error) {
    console.error('Error processing radio:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack
      })
    };
  }
}
