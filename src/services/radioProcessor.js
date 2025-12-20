import { fetchTelemetryByTimestamp, fetchSessionInfo, fetchDriverInfo } from '../resolvers/openf1';
import api, { route } from '@forge/api';

const WILLIAMS_DRIVERS = {
  23: { name: 'Alex Albon', acronym: 'ALB' },
  2: { name: 'Logan Sargeant', acronym: 'SAR' },
  55: { name: 'Carlos Sainz', acronym: 'SAI' }
};

export async function processRadioMessage(radio, sessionKey) {
  const { date, driver_number, recording_url } = radio;

  console.log(`=== Processing Radio Message ===`);
  console.log(`Driver: ${driver_number}, Timestamp: ${date}`);

  // Fetch context data in parallel
  const [telemetry, session] = await Promise.all([
    fetchTelemetryByTimestamp(sessionKey, driver_number, date),
    fetchSessionInfo(sessionKey)
  ]);

  const driver = WILLIAMS_DRIVERS[driver_number] || {
    name: `Driver ${driver_number}`,
    acronym: `D${driver_number}`
  };

  console.log(`Session: ${session?.session_name || 'Unknown'}`);
  console.log(`Telemetry available: ${!!telemetry}`);

  // Build ticket description
  const description = buildRadioTicketDescription({
    radio,
    telemetry,
    session,
    driver,
    driverNumber: driver_number
  });

  // Create Jira ticket
  console.log('Creating Jira ticket...');
  const ticket = await createRadioTicket({
    driver,
    session,
    description,
    driverNumber: driver_number,
    recordingUrl: recording_url,
    sessionKey  // ← ADD THIS
  });


  console.log(`✅ Ticket created: ${ticket.key}`);

  // Return the expected structure
  return {
    ticketKey: ticket.key,
    ticketId: ticket.id,
    telemetryFetched: !!telemetry,
    sessionInfo: session?.session_name || null
  };
}

function buildRadioTicketDescription(data) {
  const { radio, telemetry, session, driver, driverNumber } = data;

  const radioTime = new Date(radio.date);
  const formattedTime = radioTime.toISOString().substr(11, 8); // HH:MM:SS

  let desc = `*Team Radio Message*\n\n`;
  desc += `*Driver:* ${driver.name} (#${driverNumber})\n`;
  desc += `*Session:* ${session?.session_name || 'Unknown'} - ${session?.location || 'Unknown'}\n`;
  desc += `*Race Time:* ${formattedTime}\n`;
  desc += `*Timestamp:* ${radio.date}\n`;

  if (radio.recording_url) {
    desc += `*Audio Recording:* [Listen Here|${radio.recording_url}]\n`;
  }

  desc += `\n---\n\n`;
  desc += `*Telemetry at Radio Moment*\n\n`;

  if (telemetry) {
    desc += `- *Speed:* ${Math.round(telemetry.speed || 0)} km/h\n`;
    desc += `- *RPM:* ${telemetry.rpm || 'N/A'}\n`;
    desc += `- *Throttle:* ${telemetry.throttle || 0}%\n`;
    desc += `- *Brake:* ${telemetry.brake ? 'ON' : 'OFF'}\n`;
    desc += `- *Gear:* ${telemetry.n_gear || 'N/A'}\n`;
    desc += `- *DRS:* ${telemetry.drs > 10 ? 'OPEN' : 'CLOSED'}\n`;
  } else {
    desc += `_Telemetry data not available for this moment_\n`;
  }

  return desc;
}

async function createRadioTicket(data) {
  const { driver, session, description, driverNumber, sessionKey } = data;  // ← Add sessionKey

  const payload = {
    fields: {
      project: { key: 'FW47' },
      summary: `Radio: ${driver.acronym} - ${session?.session_name || 'Session'}`,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }]
          }
        ]
      },
      issuetype: { name: 'Race Incident' },
      labels: [
        `driver-${driverNumber}`,
        `session-${sessionKey}`,  // ← ADD THIS
        'team-radio',
        'auto-generated'
      ]
    }
  };

  console.log('Sending to Jira:', JSON.stringify(payload, null, 2));

  const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Jira API error: ${response.status}`, errorText);
    throw new Error(`Failed to create Jira ticket: ${response.status}`);
  }

  const result = await response.json();
  console.log('Jira response:', result);
  return result;
}
