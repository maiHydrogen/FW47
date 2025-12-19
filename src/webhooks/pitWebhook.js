import { fetchDriverInfo } from '../resolvers/openf1';
import { createJiraTicket } from '../utils/jiraHelper';

export async function handlePitWebhook(req) {
  console.log('Pit webhook triggered');
  
  try {
    // Parse JSON body if it's a string
    let payload = req.body;
    if (typeof payload === 'string') {
      console.log('Parsing JSON string body');
      payload = JSON.parse(payload);
    }
    
    console.log('Parsed payload:', JSON.stringify(payload, null, 2));
    
    const {
      session_key,
      driver_number,
      lap_number,
      pit_duration,
      date,
      stint
    } = payload;
    
    console.log('Extracted values:', { session_key, driver_number, lap_number, pit_duration });
    
    // Try to fetch driver info, but don't fail if it errors
    let driverName = `Driver #${driver_number}`;
    try {
      const driver = await fetchDriverInfo(session_key, driver_number);
      if (driver && driver.broadcast_name) {
        driverName = driver.broadcast_name;
      }
    } catch (err) {
      console.warn('Could not fetch driver info, using fallback:', err.message);
    }
    
    const description = `**Pit Stop Details:**
- Lap Number: ${lap_number}
- Pit Duration: **${(pit_duration || 0).toFixed(1)}s**
- Timestamp: ${date}

**Tyre Strategy:**
- Compound: **${stint?.compound || 'Unknown'}**
- Tyre Age at Start: ${stint?.tyre_age_at_start || 'N/A'} laps
- Stint Number: ${stint?.stint_number || 'N/A'}

**Analysis:**
View the FW47 panel for stint comparison and pit time benchmarks.`;
    
    console.log('Creating Jira ticket...');
    
    const ticket = await createJiraTicket({
      summary: `${driverName} - Pit Stop Lap ${lap_number}`,
      description,
      labels: ['pit-stop', `driver-${driver_number}`, `lap-${lap_number}`],
      priority: 'Low',
      issueTypeName: 'Strategy Calls' 
    });
    
    console.log('Ticket created:', ticket.key);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketKey: ticket.key,
        message: 'Pit stop ticket created'
      })
    };
    
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
}
