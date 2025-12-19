import api, { route } from '@forge/api';

// Williams 2025 drivers - fallback data
const WILLIAMS_DRIVERS_2025 = {
  23: { full_name: 'Alex Albon', team_name: 'Williams', team_colour: '37BEFF' },
  55: { full_name: 'Carlos Sainz', team_name: 'Williams', team_colour: '37BEFF' }
};

export async function fetchDriverInfo(session_key, driver_number) {
  try {
    const url = `https://api.openf1.org/v1/drivers?session_key=${session_key}&driver_number=${driver_number}`;
    console.log('Fetching driver info from:', url);
    
    // Use Forge api.fetch to avoid CORS/403 issues
    const response = await api.fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ForgeApp-FW47/1.0'
      }
    });
    
    console.log('OpenF1 response status:', response.status);
    
    if (!response.ok) {
      console.log('API failed, using Williams fallback data');
      if (WILLIAMS_DRIVERS_2025[driver_number]) {
        return WILLIAMS_DRIVERS_2025[driver_number];
      }
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Driver data received:', data);
    
    if (data && data.length > 0) {
      return data[0];
    }
    
    // Fallback to Williams drivers if no data
    return WILLIAMS_DRIVERS_2025[driver_number] || { 
      full_name: `Driver #${driver_number}`, 
      team_name: 'Unknown' 
    };
    
  } catch (error) {
    console.error('Error fetching driver info:', error);
    // Return Williams fallback
    return WILLIAMS_DRIVERS_2025[driver_number] || { 
      full_name: `Driver #${driver_number}`, 
      team_name: 'Unknown' 
    };
  }
}

// Fetch all 2025 race sessions
export async function fetch2025Sessions() {
  try {
    const response = await api.fetch('https://api.openf1.org/v1/sessions?year=2025', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ForgeApp-FW47/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`OpenF1 API error: ${response.status}`);
    }
    
    const sessions = await response.json();
    console.log(`Fetched ${sessions.length} sessions from 2025`);
    
    // Return only Race sessions, sorted by date
    return sessions
      .filter(s => s.session_type === 'Race')
      .sort((a, b) => new Date(b.date_start) - new Date(a.date_start)); // Most recent first
    
  } catch (error) {
    console.error('Error fetching 2025 sessions:', error);
    return [];
  }
}

// Fetch Williams driver data for a specific session
export async function fetchWilliamsSessionData(session_key) {
  const williamsDrivers = [23, 55]; // Albon, Sainz
  
  try {
    const driverDataPromises = williamsDrivers.map(async (driver_number) => {
      const response = await api.fetch(
        `https://api.openf1.org/v1/laps?session_key=${session_key}&driver_number=${driver_number}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'ForgeApp-FW47/1.0'
          }
        }
      );
      
      if (response.ok) {
        const laps = await response.json();
        return { driver_number, laps };
      }
      return { driver_number, laps: [] };
    });
    
    return await Promise.all(driverDataPromises);
    
  } catch (error) {
    console.error('Error fetching Williams session data:', error);
    return [];
  }
}

// Fetch pit stops for Williams drivers in a session
export async function fetchWilliamsPitStops(session_key) {
  const williamsDrivers = [23, 55];
  
  try {
    const pitStopPromises = williamsDrivers.map(async (driver_number) => {
      const response = await api.fetch(
        `https://api.openf1.org/v1/pit?session_key=${session_key}&driver_number=${driver_number}`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'ForgeApp-FW47/1.0'
          }
        }
      );
      
      if (response.ok) {
        const pitStops = await response.json();
        return { driver_number, pitStops };
      }
      return { driver_number, pitStops: [] };
    });
    
    return await Promise.all(pitStopPromises);
    
  } catch (error) {
    console.error('Error fetching pit stops:', error);
    return [];
  }
}

// Get latest race session key (Abu Dhabi 2025)
export async function getLatestRaceSession() {
  const sessions = await fetch2025Sessions();
  return sessions.length > 0 ? sessions[0] : null;
}
