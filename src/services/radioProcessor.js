import { fetchTelemetryByTimestamp, fetchSessionInfo, fetchDriverInfo } from '../resolvers/openf1';
import api, { route } from '@forge/api';
import { getTeamDriver, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPES } from '../config/team.js';
import { detectAnomalies } from './anomalyDetection.js';

export async function processRadioMessage(radio, sessionKey) {
  const { date, driver_number, recording_url } = radio;

  console.log(`=== Processing Radio Message ===`);
  console.log(`Driver: ${driver_number}, Timestamp: ${date}`);

  // Fetch context data in parallel
  const [telemetry, session] = await Promise.all([
    fetchTelemetryByTimestamp(sessionKey, driver_number, date),
    fetchSessionInfo(sessionKey)
  ]);

  const teamDriver = getTeamDriver(driver_number);
  const driver = teamDriver
    ? { name: teamDriver.full_name, acronym: teamDriver.acronym }
    : { name: `Driver ${driver_number}`, acronym: `D${driver_number}` };

  console.log(`Session: ${session?.session_name || 'Unknown'}`);
  console.log(`Telemetry available: ${!!telemetry}`);

  // NOTE: OpenF1's team_radio endpoint only provides an audio recording
  // URL, not a text transcript - there's no speech-to-text step in this
  // pipeline, so radio-content keyword analysis in detectAnomalies() can
  // only run when a transcript is supplied manually (e.g. via the Rovo
  // agent). Automated processing here is telemetry-only.
  const analysis = detectAnomalies(telemetry, null);
  console.log(`Anomaly analysis: ${analysis.priority} - ${analysis.reasoning}`);

  // Build ticket description
  const description = buildRadioTicketDescription({
    radio,
    telemetry,
    session,
    driver,
    driverNumber: driver_number,
    analysis
  });

  // Create Jira ticket
  console.log('Creating Jira ticket...');
  const ticket = await createRadioTicket({
    driver,
    session,
    description,
    driverNumber: driver_number,
    recordingUrl: recording_url,
    sessionKey,
    analysis
  });


  console.log(`✅ Ticket created: ${ticket.key}`);

  // Return the expected structure
  return {
    ticketKey: ticket.key,
    ticketId: ticket.id,
    telemetryFetched: !!telemetry,
    sessionInfo: session?.session_name || null,
    priority: analysis.priority,
    incidentType: analysis.incidentType
  };
}

function buildRadioTicketDescription(data) {
  const { radio, telemetry, session, driver, driverNumber, analysis } = data;

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

  if (analysis) {
    desc += `\n---\n\n`;
    desc += `*AI Analysis (Rovo Race Engineer)*\n\n`;
    desc += `- *Priority:* ${analysis.priority}\n`;
    desc += `- *Suspected Issue:* ${analysis.incidentType || 'None identified'}\n`;
    desc += `- *Reasoning:* ${analysis.reasoning}\n`;
  }

  return desc;
}

async function createRadioTicket(data) {
  const { driver, session, description, driverNumber, sessionKey, analysis } = data;

  const priority = analysis?.priority || 'Medium';
  const summaryPrefix = priority === 'Critical' ? '🚨 CRITICAL' : priority === 'High' ? '⚠️ HIGH' : 'Radio';

  const labels = [
    `driver-${driverNumber}`,
    `session-${sessionKey}`,
    'team-radio',
    'auto-generated'
  ];
  if (analysis?.incidentType) {
    labels.push(`incident-${analysis.incidentType}`);
  }

  const payload = {
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: `${summaryPrefix}: ${driver.acronym} - ${session?.session_name || 'Session'}`,
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
      issuetype: { name: JIRA_ISSUE_TYPES.incident },
      priority: { name: priority },
      labels
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
