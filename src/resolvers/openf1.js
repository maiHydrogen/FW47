import api from '@forge/api';

// Williams 2025 drivers
const WILLIAMS_DRIVERS_2025 = {
  23: { full_name: 'Alex Albon', team_name: 'Williams', team_colour: '37BEFF' },
  55: { full_name: 'Carlos Sainz', team_name: 'Williams', team_colour: '37BEFF' }
};

// Fetch all 2025 sessions
export async function fetch2025Sessions() {
  try {
    const response = await api.fetch('https://api.openf1.org/v1/sessions?year=2025');
    const data = await response.json();
    
    return data.map(session => ({
      session_key: session.session_key,
      session_name: session.session_name,
      date_start: session.date_start,
      date_end: session.date_end,
      gmt_offset: session.gmt_offset,
      session_type: session.session_type,
      meeting_key: session.meeting_key,
      location: session.location,
      country_name: session.country_name,
      circuit_short_name: session.circuit_short_name,
      year: session.year
    }));
  } catch (error) {
    console.error('Error fetching 2025 sessions:', error);
    return [];
  }
}

// Fetch driver info
export async function fetchDriverInfo(driverNumber) {
  if (WILLIAMS_DRIVERS_2025[driverNumber]) {
    return WILLIAMS_DRIVERS_2025[driverNumber];
  }
  
  try {
    const response = await api.fetch(`https://api.openf1.org/v1/drivers?driver_number=${driverNumber}&session_key=latest`);
    const data = await response.json();
    return data[0] || { full_name: `Driver #${driverNumber}`, team_name: 'Unknown' };
  } catch (error) {
    console.error('Error fetching driver info:', error);
    return { full_name: `Driver #${driverNumber}`, team_name: 'Unknown' };
  }
}

// Fetch lap info (lap time, sectors)
export async function fetchLapInfo(sessionKey, driverNumber, lapNumber) {
  try {
    console.log(`Fetching lap info for session=${sessionKey}, driver=${driverNumber}, lap=${lapNumber}`);
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}`
    );
    const data = await response.json();
    
    if (data.length === 0) {
      console.log('No lap data found');
      return null;
    }
    
    const lap = data[0];
    return {
      lap_number: lap.lap_number,
      lap_duration: lap.lap_duration,
      is_pit_out_lap: lap.is_pit_out_lap,
      duration_sector_1: lap.duration_sector_1,
      duration_sector_2: lap.duration_sector_2,
      duration_sector_3: lap.duration_sector_3,
      segments_sector_1: lap.segments_sector_1,
      segments_sector_2: lap.segments_sector_2,
      segments_sector_3: lap.segments_sector_3
    };
  } catch (error) {
    console.error('Error fetching lap info:', error);
    return null;
  }
}
// Fetch team radio messages
export async function fetchTeamRadio(sessionKey, driverNumber = null) {
  let url = `https://api.openf1.org/v1/team_radio?session_key=${sessionKey}`;
  
  if (driverNumber) {
    url += `&driver_number=${driverNumber}`;
  }
  
  console.log(`Fetching team radio: ${url}`);
  
  const response = await api.fetch(url);
  
  if (!response.ok) {
    console.error(`OpenF1 team_radio API error: ${response.status}`);
    return [];
  }
  
  const radios = await response.json();
  console.log(`Found ${radios.length} radio messages`);
  
  return radios;
}

/// Fetch telemetry around a specific timestamp (for radio messages)
export async function fetchTelemetryByTimestamp(sessionKey, driverNumber, timestamp) {
  try {
    console.log(`Fetching telemetry around ${timestamp}`);
    
    // Use a wider time window (30 seconds before and after)
    const startDate = new Date(new Date(timestamp).getTime() - 30000); 
    const endDate = new Date(new Date(timestamp).getTime() + 30000);
    
    console.log(`Time window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${startDate.toISOString()}&date<=${endDate.toISOString()}`
    );
    
    console.log('OpenF1 telemetry response status:', response.status);
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      console.log('Invalid response format:', typeof data);
      return null;
    }
    
    console.log(`Found ${data.length} telemetry data points`);
    
    if (data.length === 0) {
      console.log('No telemetry data found for timestamp');
      return null;
    }
    
    // Calculate statistics from all data points
    const speeds = data.map(d => d.speed || 0).filter(s => s > 0);
    const rpms = data.map(d => d.rpm || 0).filter(r => r > 0);
    const throttles = data.map(d => d.throttle || 0);
    const brakes = data.map(d => d.brake || 0);
    const gears = data.map(d => d.n_gear || 0).filter(g => g > 0);
    const drsValues = data.map(d => d.drs || 0);
    
    const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr) => arr.length > 0 ? Math.max(...arr) : 0;
    
    const telemetry = {
      speed: Math.round(avg(speeds)),
      speed_max: Math.round(max(speeds)),
      rpm: Math.round(avg(rpms)),
      rpm_max: Math.round(max(rpms)),
      throttle: Math.round(avg(throttles)),
      brake: Math.round(max(brakes)),
      n_gear: Math.round(max(gears)),
      drs: drsValues.some(d => d > 0) ? 12 : 0,
      data_points: data.length
    };
    
    console.log('Telemetry calculated:', telemetry);
    return telemetry;
    
  } catch (error) {
    console.error('Error fetching telemetry by timestamp:', error);
    return null;
  }
}
export async function fetchLapTelemetry(sessionKey, driverNumber, lapNumber) {
  try {
    console.log(`Fetching telemetry for session=${sessionKey}, driver=${driverNumber}, lap=${lapNumber}`);
    
    const lapInfo = await fetchLapInfo(sessionKey, driverNumber, lapNumber);
    
    if (!lapInfo) {
      console.log('Cannot fetch telemetry without lap timing data');
      return null;
    }
    
    const lapResponse = await api.fetch(
      `https://api.openf1.org/v1/laps?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}`
    );
    const lapData = await lapResponse.json();
    
    if (!lapData || lapData.length === 0 || !lapData[0].date_start) {
      console.log('Cannot determine lap start time');
      return null;
    }
    
    const lapStartTime = lapData[0].date_start;
    const startDate = new Date(lapStartTime);
    const endDate = new Date(startDate.getTime() + ((lapInfo.lap_duration || 90) + 5) * 1000);
    
    console.log('Querying telemetry window:', startDate.toISOString(), 'to', endDate.toISOString());
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${startDate.toISOString()}&date<=${endDate.toISOString()}`
    );
    
    console.log('OpenF1 response status:', response.status);
    const data = await response.json();
    
    // Handle error responses
    if (!Array.isArray(data)) {
      console.log('OpenF1 API error:', data.detail || 'Unknown error');
      return [];  // Return empty array instead of null
    }
    
    if (data.length === 0) {
      console.log('No car data available for this time window');
      return [];  // Return empty array instead of null
    }
    
    console.log(`Returning ${data.length} raw telemetry data points`);
    
    // Return raw data points with standardized field names
    return data.map(point => ({
      speed: point.speed || 0,
      rpm: point.rpm || 0,
      throttle: point.throttle || 0,
      brake: point.brake || 0,
      gear: point.n_gear || 0,
      drs: point.drs || 0,
      date: point.date
    }));
    
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return [];  // Return empty array on error
  }
}



// Fetch pit stop data
export async function fetchPitStopData(sessionKey, driverNumber, lapNumber) {
  try {
    console.log(`Fetching pit stop for session=${sessionKey}, driver=${driverNumber}`);
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/pit?session_key=${sessionKey}&driver_number=${driverNumber}`
    );
    const data = await response.json();
    
    if (data.length === 0) {
      console.log('No pit stop data found');
      return null;
    }
    
    // Find pit stop for the specified lap or closest one
    let pitStop;
    if (lapNumber) {
      pitStop = data.find(p => p.lap_number === lapNumber) || 
                data.reduce((prev, curr) => {
                  return (Math.abs(curr.lap_number - lapNumber) < Math.abs(prev.lap_number - lapNumber)) 
                    ? curr : prev;
                });
    } else {
      pitStop = data[data.length - 1]; // Get latest pit stop
    }
    
    return {
      lap_number: pitStop.lap_number,
      pit_duration: pitStop.pit_duration,
      date: pitStop.date
    };
  } catch (error) {
    console.error('Error fetching pit stop data:', error);
    return null;
  }
}

// Fetch stint data (tyre compound info)
export async function fetchStintData(sessionKey, driverNumber) {
  try {
    console.log(`Fetching stints for session=${sessionKey}, driver=${driverNumber}`);
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/stints?session_key=${sessionKey}&driver_number=${driverNumber}`
    );
    const data = await response.json();
    
    if (data.length === 0) {
      console.log('No stint data found');
      return [];
    }
    
    return data.map(stint => ({
      stint_number: stint.stint_number,
      lap_start: stint.lap_start,
      lap_end: stint.lap_end,
      compound: stint.compound, // SOFT, MEDIUM, HARD, INTERMEDIATE, WET
      tyre_age_at_start: stint.tyre_age_at_start
    }));
  } catch (error) {
    console.error('Error fetching stint data:', error);
    return [];
  }
}

// Get session info
export async function fetchSessionInfo(sessionKey) {
  try {
    console.log(`Fetching session info for session=${sessionKey}`);
    
    const response = await api.fetch(
      `https://api.openf1.org/v1/sessions?session_key=${sessionKey}`
    );
    const data = await response.json();
    
    if (data.length === 0) {
      console.log('No session data found');
      return null;
    }
    
    const session = data[0];
    return {
      session_name: session.session_name,
      date_start: session.date_start,
      date_end: session.date_end,
      location: session.location,
      country_name: session.country_name,
      circuit_short_name: session.circuit_short_name,
      session_type: session.session_type,
      year: session.year
    };
  } catch (error) {
    console.error('Error fetching session info:', error);
    return null;
  }
}
