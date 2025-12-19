import { fetchDriverInfo } from '../resolvers/openf1';
import { createJiraTicket } from '../utils/jiraHelper';

export async function handleRadioWebhook(req) {
  console.log('Radio webhook triggered');

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
      date,
      recording_url,
      telemetry
    } = payload;

    console.log('Extracted values:', { session_key, driver_number, date });

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

    // Format description
    const description = `**Radio Timestamp:** ${date}
**Audio:** [Listen to Radio](${recording_url})

**Telemetry Snapshot:**
- Speed: ${telemetry?.speed || 'N/A'} km/h
- RPM: ${telemetry?.rpm || 'N/A'}
- Throttle: ${telemetry?.throttle || 'N/A'}%
- Brake: ${telemetry?.brake === 100 ? 'APPLIED' : 'OFF'}
- Gear: ${telemetry?.n_gear || 'N/A'}
- DRS: ${getDRSStatus(telemetry?.drs)}

**Action Required:** Analyze radio message and classify incident.`;

    // Calculate labels
    const labels = ['radio-message', `driver-${driver_number}`];
    if (telemetry?.brake === 100 && telemetry?.speed > 250) {
      labels.push('emergency-braking', 'high-priority');
    }

    console.log('Creating Jira ticket...');

    // Create ticket
    const ticket = await createJiraTicket({
      summary: `${driverName} - Radio ${new Date(date).toLocaleTimeString()}`,
      description,
      labels,
      priority: 'Medium',
      issueTypeName: "Race Incident"
    });

    console.log('Ticket created:', ticket.key);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketKey: ticket.key,
        message: 'Radio incident ticket created',
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

function getDRSStatus(drsValue) {
  const drsMap = {
    0: 'OFF', 1: 'OFF', 8: 'Eligible', 10: 'ON', 12: 'ON', 14: 'ON'
  };
  return drsMap[drsValue] || 'Unknown';
}
