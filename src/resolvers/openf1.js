const OPENF1_BASE = 'https://api.openf1.org/v1';

export async function fetchTelemetryData(sessionKey, driverNumber) {
  try {
    const url = `${OPENF1_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`;
    console.log('Fetching telemetry from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return [];
  }
}

export async function fetchStintData(sessionKey, driverNumber) {
  try {
    const url = `${OPENF1_BASE}/stints?session_key=${sessionKey}&driver_number=${driverNumber}`;
    console.log('Fetching stints from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching stints:', error);
    return [];
  }
}

export async function fetchPitStops(sessionKey, driverNumber) {
  try {
    const url = `${OPENF1_BASE}/pit?session_key=${sessionKey}&driver_number=${driverNumber}`;
    console.log('Fetching pits from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching pits:', error);
    return [];
  }
}

export async function fetchTeamRadio(sessionKey, driverNumber) {
  try {
    const url = `${OPENF1_BASE}/team_radio?session_key=${sessionKey}&driver_number=${driverNumber}`;
    console.log('Fetching radio from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching radio:', error);
    return [];
  }
}

export async function fetchDriverInfo(sessionKey, driverNumber) {
  try {
    const url = `${OPENF1_BASE}/drivers?session_key=${sessionKey}&driver_number=${driverNumber}`;
    console.log('Fetching driver info from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Driver info response:', JSON.stringify(data));
    return data[0];
  } catch (error) {
    console.error('Error fetching driver info:', error);
    return null;
  }
}

export async function fetchSessionKey(year, countryName, sessionName) {
  try {
    const url = `${OPENF1_BASE}/sessions?year=${year}&country_name=${countryName}&session_name=${sessionName}`;
    console.log('Fetching session from:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data[0]?.session_key;
  } catch (error) {
    console.error('Error fetching session:', error);
    return null;
  }
}
