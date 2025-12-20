/**
 * Data validation utilities for FW47 Race Operations
 * Prevents crashes from malformed API responses
 */

/**
 * Validate telemetry data array
 * @param {any} data 
 * @returns {Array|null}
 */
export const validateTelemetryData = (data) => {
  if (!data) return null;
  
  if (!Array.isArray(data)) {
    console.warn('[Validator] Telemetry data is not an array:', typeof data);
    return null;
  }
  
  if (data.length === 0) {
    console.info('[Validator] Telemetry array is empty');
    return null;
  }
  
  // Filter out invalid data points
  const validData = data.filter(point => 
    point &&
    typeof point === 'object' &&
    typeof point.speed === 'number' &&
    typeof point.throttle === 'number'
  );
  
  if (validData.length === 0) {
    console.warn('[Validator] No valid telemetry points found');
    return null;
  }
  
  console.info(`[Validator] Validated ${validData.length} telemetry points`);
  return validData;
};

/**
 * Validate pit strategy data
 * @param {any} data 
 * @returns {Object|null}
 */
export const validatePitStrategy = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }
  
  const validated = {
    stints: Array.isArray(data.stints) ? data.stints : [],
    allPitStops: Array.isArray(data.allPitStops) ? data.allPitStops : []
  };
  
  if (validated.stints.length === 0 && validated.allPitStops.length === 0) {
    console.info('[Validator] No pit strategy data available');
    return null;
  }
  
  console.info(`[Validator] Validated pit strategy: ${validated.stints.length} stints, ${validated.allPitStops.length} stops`);
  return validated;
};

/**
 * Validate lap times data
 * @param {any} data 
 * @returns {Object|null}
 */
export const validateLapTimes = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }
  
  if (!Array.isArray(data.laps) || data.laps.length === 0) {
    console.warn('[Validator] Invalid lap times data');
    return null;
  }
  
  console.info(`[Validator] Validated ${data.laps.length} laps`);
  
  return {
    laps: data.laps,
    bestLap: typeof data.bestLap === 'number' ? data.bestLap : null
  };
};
