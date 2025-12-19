import { fetchDriverInfo } from '../resolvers/openf1.js';
import { createJiraTicket } from '../utils/jiraHelper.js';

export async function handleRadioWebhook(event) {
  try {
    console.log('Radio webhook triggered');
    
    const body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    console.log('Parsing JSON string body');
    const payload = JSON.parse(body);
    console.log('Parsed payload:', payload);

    const { 
      session_key, 
      driver_number, 
      date, 
      recording_url, 
      telemetry,
      incident_type = 'General Radio', // crash, track-limit, safety-car, etc.
      severity = 'Medium', // Low, Medium, High
      lap_number
    } = payload;

    console.log('Extracted values:', { session_key, driver_number, date, incident_type });

    // Fetch driver info
    let driverName = `Driver #${driver_number}`;
    try {
      console.log('Fetching driver info from:', `https://api.openf1.org/v1/drivers?session_key=${session_key}&driver_number=${driver_number}`);
      const driverInfo = await fetchDriverInfo(session_key, driver_number);
      driverName = driverInfo.full_name || driverName;
      console.log('Driver name:', driverName);
    } catch (error) {
      console.error('Error fetching driver info:', error);
      // Continue with fallback name
    }

    // Build description
    const description = `**Incident Type:** ${incident_type}
**Radio Timestamp:** ${date}
**Audio:** [Listen to Radio](${recording_url})

**Telemetry Snapshot:**
- Speed: ${telemetry.speed} km/h
- RPM: ${telemetry.rpm}
- Throttle: ${telemetry.throttle}%
- Brake: ${telemetry.brake ? 'ON' : 'OFF'}
- Gear: ${telemetry.n_gear}
- DRS: ${telemetry.drs > 0 ? 'ON' : 'OFF'}

**Action Required:** Analyze radio message and classify incident.`;

    const labels = [
      'radio-message', 
      `driver-${driver_number}`, 
      incident_type.toLowerCase().replace(/\s+/g, '-')
    ];
    
    if (lap_number) {
      labels.push(`lap-${lap_number}`);
    }

    console.log('Creating Jira ticket...');
    const ticket = await createJiraTicket({
      summary: `${driverName} - ${incident_type}${lap_number ? ` (Lap ${lap_number})` : ''}`,
      description,
      labels,
      priority: severity,
      issueTypeName: 'Race Incident'
    });
    
    console.log('Ticket created:', ticket.key);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketKey: ticket.key,
        ticketId: ticket.id,
        data: {
          driver_number,
          driverName,
          incident_type,
          severity,
          telemetry,
          date,
          lap_number
        }
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
