/**
 * Calculate session statistics from lap times and pit strategy
 */
export const calculateSessionStats = (lapTimes, pitStrategy) => {
  const totalLaps = lapTimes?.laps?.length || 0;
  const validLaps = lapTimes?.laps?.filter(l => l.lap_duration && !l.is_pit_out_lap).length || 0;
  
  const avgLapTime = validLaps > 0 
    ? (lapTimes.laps.filter(l => l.lap_duration && !l.is_pit_out_lap)
        .reduce((sum, l) => sum + l.lap_duration, 0) / validLaps).toFixed(3)
    : 'N/A';
  
  const pitStops = pitStrategy?.stints?.length - 1 || 0;

  return {
    totalLaps,
    validLaps,
    avgLapTime,
    pitStops
  };
};

/**
 * Calculate lap delta from best lap
 */
export const calculateLapDelta = (lapTime, bestLap) => {
  if (!lapTime || !bestLap || lapTime === bestLap) return null;
  return (lapTime - bestLap).toFixed(3);
};

/**
 * Determine if stint is current (last in array)
 */
export const isCurrentStint = (stintIndex, totalStints) => {
  return stintIndex === totalStints - 1;
};
