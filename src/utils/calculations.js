/**
 * Calculate session statistics from lap times and pit strategy
 * FIXED: Added null safety checks to prevent crashes
 */
export const calculateSessionStats = (lapTimes, pitStrategy) => {
  // Safety: Ensure laps exists and is an array
  const laps = Array.isArray(lapTimes?.laps) ? lapTimes.laps : [];

  const totalLaps = laps.length;

  // Safe filtering with existence check
  const validLapObjects = laps.filter(l =>
    l &&
    typeof l.lap_duration === 'number' &&
    l.lap_duration > 0 &&
    !l.is_pit_out_lap
  );
  const validLaps = validLapObjects.length;

  // Calculate average only if valid laps exist
  const avgLapTime = validLaps > 0
    ? (validLapObjects.reduce((sum, l) => sum + l.lap_duration, 0) / validLaps).toFixed(3)
    : 'N/A';

  // Safe pit stop calculation
  const pitStops = Array.isArray(pitStrategy?.stints) && pitStrategy.stints.length > 0
    ? pitStrategy.stints.length - 1
    : 0;

  return {
    totalLaps,
    validLaps,
    avgLapTime,
    pitStops
  };
};

/**
 * Calculate lap delta from best lap
 * FIXED: Added safety checks
 */
export const calculateLapDelta = (lapTime, bestLap) => {
  if (!lapTime || !bestLap || lapTime === bestLap) return null;
  if (typeof lapTime !== 'number' || typeof bestLap !== 'number') return null;
  return (lapTime - bestLap).toFixed(3);
};

/**
 * Determine if stint is current (last in array)
 */
export const isCurrentStint = (stintIndex, totalStints) => {
  return stintIndex === totalStints - 1;
};

/**
 * NEW: Classify pit stop speed
 * @param {number} duration - Pit stop duration in seconds
 * @returns {string} - 'fast', 'normal', or 'slow'
 */
export const classifyPitStop = (duration) => {
  if (!duration || typeof duration !== 'number') return 'unknown';
  if (duration < 2.5) return 'fast';
  if (duration > 3.0) return 'slow';
  return 'normal';
};
/**
 * Calculate consistency score (standard deviation of lap times)
 * Lower score = more consistent
 */
export const calculateConsistency = (laps, avgLapTime) => {
  if (!Array.isArray(laps) || laps.length === 0 || avgLapTime === 'N/A') {
    return null;
  }

  const validLaps = laps.filter(l => l.lap_duration && !l.is_pit_out_lap);
  if (validLaps.length === 0) return null;

  const avg = parseFloat(avgLapTime);
  const variance = validLaps.reduce((sum, l) =>
    sum + Math.pow(l.lap_duration - avg, 2), 0
  ) / validLaps.length;

  return Math.sqrt(variance);
};

/**
 * Determine tire degradation risk level
 */
export const getTireDegradationRisk = (stintLength) => {
  if (stintLength > 20) return 'high';
  if (stintLength > 15) return 'medium';
  return 'low';
};

/**
 * Calculate speed distribution percentages
 */
export const getSpeedDistribution = (telemetryPoints) => {
  if (!Array.isArray(telemetryPoints) || telemetryPoints.length === 0) {
    return { high: 0, medium: 0, low: 0 };
  }

  const total = telemetryPoints.length;
  return {
    high: (telemetryPoints.filter(p => p.speed > 300).length / total) * 100,
    medium: (telemetryPoints.filter(p => p.speed >= 200 && p.speed <= 300).length / total) * 100,
    low: (telemetryPoints.filter(p => p.speed < 200).length / total) * 100
  };
};
