import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

const FW47Panel = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [stints, setStints] = useState([]);
  const [pitStops, setPitStops] = useState([]);
  const [driverNumber, setDriverNumber] = useState(23); // Default: Albon
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [driverNumber]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [telData, stintData, pitData] = await Promise.all([
        invoke('getTelemetryData', { driverNumber }),
        invoke('getStintData', { driverNumber }),
        invoke('getPitStopComparison', { driverNumber })
      ]);
      
      setTelemetry(telData);
      setStints(stintData);
      setPitStops(pitData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  };

  if (loading) {
    return <div style={styles.container}>Loading FW47 data...</div>;
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h2>FW47 Race Engineer</h2>
        <select 
          value={driverNumber} 
          onChange={(e) => setDriverNumber(Number(e.target.value))}
          style={styles.select}
        >
          <option value={23}>Alex Albon (#23)</option>
          <option value={55}>Carlos Sainz (#55)</option>
        </select>
      </header>

      {/* Telemetry Section */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>📊 Current Telemetry</h3>
        {telemetry ? (
          <table style={styles.table}>
            <tbody>
              <tr>
                <td style={styles.td}>Speed</td>
                <td style={styles.tdValue}>{telemetry.speed || 'N/A'} km/h</td>
              </tr>
              <tr>
                <td style={styles.td}>RPM</td>
                <td style={styles.tdValue}>{telemetry.rpm || 'N/A'}</td>
              </tr>
              <tr>
                <td style={styles.td}>Throttle</td>
                <td style={styles.tdValue}>{telemetry.throttle || 'N/A'}%</td>
              </tr>
              <tr>
                <td style={styles.td}>Brake</td>
                <td style={styles.tdValue}>{telemetry.brake === 100 ? '🔴 APPLIED' : '⚪ OFF'}</td>
              </tr>
              <tr>
                <td style={styles.td}>Gear</td>
                <td style={styles.tdValue}>{telemetry.n_gear || 'N/A'}</td>
              </tr>
              <tr>
                <td style={styles.td}>DRS</td>
                <td style={styles.tdValue}>{getDRSStatus(telemetry.drs)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>No telemetry data available</p>
        )}
      </section>

      {/* Stint Analysis */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>🏁 Stint Analysis</h3>
        {stints.length > 0 ? (
          <div>
            {stints.map((stint, idx) => (
              <div key={idx} style={styles.stintCard}>
                <strong>Stint {stint.stint_number}</strong>
                <div>Compound: <span style={styles.badge}>{stint.compound}</span></div>
                <div>Laps: {stint.lap_start} → {stint.lap_end} ({stint.lap_end - stint.lap_start + 1} laps)</div>
                <div>Tyre age at start: {stint.tyre_age_at_start} laps</div>
              </div>
            ))}
          </div>
        ) : (
          <p>No stint data available</p>
        )}
      </section>

      {/* Pit Stop Comparison */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>⏱️ Pit Stop Times</h3>
        {pitStops.length > 0 ? (
          <div>
            {pitStops.map((pit, idx) => (
              <div key={idx} style={styles.pitCard}>
                <div style={styles.pitLap}>Lap {pit.lap_number}</div>
                <div style={styles.barContainer}>
                  <div 
                    style={{
                      ...styles.bar,
                      width: `${Math.min(pit.pit_duration * 3, 150)}px`,
                      backgroundColor: pit.pit_duration < 25 ? '#0052CC' : '#FF5630'
                    }}
                  />
                  <span style={styles.barLabel}>{pit.pit_duration.toFixed(1)}s</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No pit stop data available</p>
        )}
      </section>
    </div>
  );
};

function getDRSStatus(drsValue) {
  const drsMap = {
    0: '⚪ OFF', 1: '⚪ OFF', 8: '🟡 Eligible', 10: '🟢 ON', 12: '🟢 ON', 14: '🟢 ON'
  };
  return drsMap[drsValue] || 'Unknown';
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '20px',
    maxWidth: '800px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: '2px solid #0052CC',
    paddingBottom: '10px'
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '4px',
    border: '1px solid #DFE1E6',
    cursor: 'pointer'
  },
  section: {
    marginBottom: '30px',
    backgroundColor: '#F4F5F7',
    padding: '15px',
    borderRadius: '8px'
  },
  sectionTitle: {
    marginTop: 0,
    color: '#172B4D',
    fontSize: '18px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  td: {
    padding: '10px',
    borderBottom: '1px solid #DFE1E6',
    fontWeight: '500',
    color: '#5E6C84'
  },
  tdValue: {
    padding: '10px',
    borderBottom: '1px solid #DFE1E6',
    textAlign: 'right',
    fontWeight: 'bold',
    color: '#172B4D'
  },
  stintCard: {
    backgroundColor: 'white',
    padding: '12px',
    marginBottom: '10px',
    borderRadius: '4px',
    borderLeft: '4px solid #0052CC'
  },
  badge: {
    backgroundColor: '#0052CC',
    color: 'white',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  pitCard: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '12px',
    backgroundColor: 'white',
    padding: '10px',
    borderRadius: '4px'
  },
  pitLap: {
    width: '80px',
    fontWeight: 'bold',
    color: '#172B4D'
  },
  barContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center'
  },
  bar: {
    height: '24px',
    borderRadius: '4px',
    marginRight: '10px'
  },
  barLabel: {
    fontWeight: 'bold',
    color: '#172B4D'
  }
};

export default FW47Panel;
