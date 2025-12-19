import { 
  fetchDriverInfo, 
  fetchPitStopData, 
  fetchStintData,
  fetchSessionInfo 
} from '../resolvers/openf1.js';
import { createJiraTicket } from '../utils/jiraHelper.js';

export async function handlePitWebhook(event) {
  try {
    console.log('=== Pit Stop Webhook Triggered ===');
    
    const body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    const payload = JSON.parse(body);
    console.log('Payload received:', JSON.stringify(payload, null, 2));

    const { 
      session_key, 
      driver_number, 
      lap_number,
      date
    } = payload;

    // Validate required fields
    if (!session_key || !driver_number) {
      throw new Error('Missing required fields: session_key and driver_number');
    }

    console.log(`\n=== Fetching Data from OpenF1 ===`);
    
    // Fetch all data from OpenF1 API
    const [driverInfo, sessionInfo, pitData, stints] = await Promise.all([
      fetchDriverInfo(driver_number),
      fetchSessionInfo(session_key),
      fetchPitStopData(session_key, driver_number, lap_number),
      fetchStintData(session_key, driver_number)
    ]);
    
    console.log('Driver info:', driverInfo);
    console.log('Session info:', sessionInfo);
    console.log('Pit stop data:', pitData);
    console.log('Stints:', stints);
    
    const driverName = driverInfo.full_name || `Driver #${driver_number}`;
    
    // Find current stint based on pit stop lap
    const pitLapNumber = pitData?.lap_number || lap_number;
    const currentStint = stints.find(s => 
      pitLapNumber && pitLapNumber >= s.lap_start && (!s.lap_end || pitLapNumber <= s.lap_end)
    );
    
    // Build description
    let description = `*Pit Stop Analysis*\n\n`;
    description += `*Driver:* ${driverName} (#${driver_number})\n`;
    description += `*Team:* ${driverInfo.team_name || 'Unknown'}\n`;
    
    if (sessionInfo) {
      description += `*Session:* ${sessionInfo.session_name} - ${sessionInfo.location}\n`;
      description += `*Circuit:* ${sessionInfo.circuit_short_name}\n`;
      description += `*Date:* ${new Date(sessionInfo.date_start).toLocaleDateString()}\n`;
    } else {
      description += `*Session Key:* ${session_key}\n`;
    }
    
    description += `*Lap:* ${pitLapNumber || 'N/A'}\n`;
    description += `*Time:* ${new Date(date || Date.now()).toLocaleString()}\n\n`;
    
    if (pitData) {
      description += `*Pit Stop Details:*\n`;
      description += `• Lap Number: ${pitData.lap_number}\n`;
      description += `• Duration: ${pitData.pit_duration ? pitData.pit_duration.toFixed(2) + 's' : 'N/A'}\n`;
      description += `• Timestamp: ${new Date(pitData.date).toLocaleTimeString()}\n\n`;
    } else {
      description += `_Pit stop data not available from OpenF1_\n\n`;
    }
    
    if (currentStint) {
      description += `*Current Stint:*\n`;
      description += `• Stint Number: ${currentStint.stint_number}\n`;
      description += `• Tyre Compound: ${currentStint.compound}\n`;
      description += `• Tyre Age at Start: ${currentStint.tyre_age_at_start} laps\n`;
      description += `• Stint Laps: ${currentStint.lap_start} - ${currentStint.lap_end || 'ongoing'}\n\n`;
    }
    
    if (stints.length > 0) {
      description += `*Race Strategy (All Stints):*\n`;
      stints.forEach(stint => {
        const stintLength = stint.lap_end ? stint.lap_end - stint.lap_start + 1 : 'ongoing';
        description += `• Stint ${stint.stint_number}: ${stint.compound} (${stintLength} laps, started lap ${stint.lap_start})\n`;
      });
    } else {
      description += `_Stint data not available from OpenF1_\n`;
    }

    // Create labels
    const labels = [
      `driver-${driver_number}`,
      'pitstop',
      `session-${session_key}`
    ];
    
    if (pitLapNumber) {
      labels.push(`lap-${pitLapNumber}`);
    }
    
    if (currentStint?.compound) {
      labels.push(`tyre-${currentStint.compound.toLowerCase()}`);
    }

    if (sessionInfo?.session_type) {
      labels.push(sessionInfo.session_type.toLowerCase().replace(' ', '-'));
    }

    console.log('\n=== Creating Jira Ticket ===');
    
    // Create ticket
    const ticket = await createJiraTicket({
      summary: `${driverName} - Pit Stop (Lap ${pitLapNumber || '?'})`,
      description,
      labels,
      priority: 'Medium',
      issueTypeName: 'Strategy Calls'
    });

    console.log(`✅ Ticket created: ${ticket.key}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ticketKey: ticket.key,
        ticketId: ticket.id,
        pitDuration: pitData?.pit_duration,
        tyreCompound: currentStint?.compound,
        stintsCount: stints.length,
        dataFetched: {
          driver: !!driverInfo,
          session: !!sessionInfo,
          pitStop: !!pitData,
          stints: stints.length > 0
        }
      })
    };

  } catch (error) {
    console.error('❌ Error in pit stop webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
