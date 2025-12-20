import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Tabs, TabList, Tab, TabPanel,
  Text, Box, Stack, Inline, Spinner, Strong,
  SectionMessage, Badge
} from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [context, setContext] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [pitStrategy, setPitStrategy] = useState(null);
  const [lapTimes, setLapTimes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // STEP 1: Get ticket context (driver, session, lap from labels)
        console.log('Fetching ticket context...');
        const ctx = await invoke('get-ticket-context');

        console.log('Context received:', ctx);
        setContext(ctx);

        // If no race data labels, stop here
        if (ctx.noData) {
          setLoading(false);
          return;
        }

        // STEP 2: Fetch all data in parallel using context
        const payload = {
          sessionKey: ctx.sessionKey,
          driverNumber: ctx.driverNumber,
          lapNumber: ctx.lapNumber
        };

        console.log('Fetching race data with payload:', payload);

        const [telemetryData, pitData, lapData] = await Promise.all([
          invoke('get-telemetry-data', payload),
          invoke('get-pit-strategy', payload),
          invoke('get-lap-times', payload)
        ]);
        console.log('Telemetry type:', typeof telemetryData, 'isArray:', Array.isArray(telemetryData));
        console.log('Telemetry data:', telemetryData);

        setTelemetry(telemetryData);
        setPitStrategy(pitData);
        setLapTimes(lapData);

      } catch (err) {
        console.error('Error loading data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <Box padding="space.300">
        <Spinner size="large" label="Loading FW47 Race Operations..." />
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding="space.300">
        <SectionMessage appearance="error" title="Error loading data">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }

  // Show message if no race labels
  if (context?.noData) {
    return (
      <Box padding="space.300">
        <SectionMessage appearance="info" title="No Race Operations Data">
          <Text>{context.message}</Text>
          <Text>
            Add labels like <Strong>driver-23</Strong>, <Strong>session-9158</Strong>
            to this ticket to view race data.
          </Text>
        </SectionMessage>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header with driver and session info */}
      <Box padding="space.200" backgroundColor="color.background.information">
        <Stack space="space.100">
          <Inline space="space.100" alignBlock="center">
            <Strong>Driver:</Strong>
            <Text>{context.driverName} (#{context.driverNumber})</Text>
          </Inline>
          <Inline space="space.100" alignBlock="center">
            <Strong>Session:</Strong>
            <Text>{context.sessionName} - {context.sessionType}</Text>
            <Badge text={context.location} appearance="default" />
          </Inline>
        </Stack>
      </Box>

      <Tabs id="fw47-race-tabs">
        <TabList>
          <Tab>Driver Info</Tab>
          <Tab>Telemetry</Tab>
          <Tab>Pit Strategy</Tab>
          <Tab>Lap Times</Tab>
        </TabList>

        {/* TAB 1: Driver Info */}
        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Text size="large" weight="bold">Driver Information</Text>

              <Box backgroundColor="color.background.neutral" padding="space.150">
                <Stack space="space.100">
                  <Inline space="space.100">
                    <Text weight="medium">Full Name:</Text>
                    <Text>{context.driverName}</Text>
                  </Inline>
                  <Inline space="space.100">
                    <Text weight="medium">Car Number:</Text>
                    <Text>#{context.driverNumber}</Text>
                  </Inline>
                  <Inline space="space.100">
                    <Text weight="medium">Session:</Text>
                    <Text>{context.sessionName}</Text>
                  </Inline>
                  <Inline space="space.100">
                    <Text weight="medium">Circuit:</Text>
                    <Text>{context.location}</Text>
                  </Inline>
                  <Inline space="space.100">
                    <Text weight="medium">Session Type:</Text>
                    <Badge text={context.sessionType} appearance="primary" />
                  </Inline>
                </Stack>
              </Box>
            </Stack>
          </Box>
        </TabPanel>

        {/* TAB 2: Telemetry */}
        {/* TAB 2: Telemetry */}
        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Text size="large" weight="bold">
                Telemetry Data {context.lapNumber && `(Lap ${context.lapNumber})`}
              </Text>

              {!context.lapNumber ? (
                <SectionMessage appearance="warning">
                  <Text>Add a <Strong>lap-XX</Strong> label to view telemetry data</Text>
                </SectionMessage>
              ) : !telemetry ? (
                <Text>No telemetry data available for this lap</Text>
              ) : !Array.isArray(telemetry) ? (
                <Text>Telemetry data format not supported (expected array, got {typeof telemetry})</Text>
              ) : telemetry.length === 0 ? (
                <Text>No telemetry points found for lap {context.lapNumber}</Text>
              ) : (
                <Stack space="space.100">
                  {telemetry.slice(0, 20).map((point, idx) => (
                    <Box key={idx} padding="space.100" backgroundColor="color.background.neutral">
                      <Inline space="space.200" spread="space-between">
                        <Text size="small">Speed: {point.speed || 'N/A'} km/h</Text>
                        <Text size="small">Throttle: {point.throttle || 0}%</Text>
                        <Text size="small">Brake: {point.brake || 0}%</Text>
                        <Text size="small">RPM: {point.rpm || 'N/A'}</Text>
                      </Inline>
                    </Box>
                  ))}
                  {telemetry.length > 20 && (
                    <Text size="small">Showing first 20 of {telemetry.length} data points</Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Box>
        </TabPanel>


        {/* TAB 3: Pit Strategy */}
        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Text size="large" weight="bold">Pit Stop Strategy</Text>

              {!pitStrategy || pitStrategy.stints?.length === 0 ? (
                <Text>No pit stop data available</Text>
              ) : (
                <>
                  <Text weight="medium">Stints:</Text>
                  <Stack space="space.100">
                    {pitStrategy.stints.map((stint, idx) => (
                      <Box key={idx} padding="space.150" backgroundColor="color.background.neutral">
                        <Stack space="space.050">
                          <Inline space="space.100">
                            <Text weight="bold">Stint {stint.stint_number}</Text>
                            <Badge text={stint.compound || 'Unknown'} />
                          </Inline>
                          <Text size="small">
                            Laps {stint.lap_start} - {stint.lap_end}
                            ({stint.lap_end - stint.lap_start + 1} laps)
                          </Text>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>

                  {pitStrategy.allPitStops?.length > 0 && (
                    <>
                      <Text weight="medium">All Pit Stops (Both Drivers):</Text>
                      <Stack space="space.100">
                        {pitStrategy.allPitStops.map((pit, idx) => (
                          <Box key={idx} padding="space.100" backgroundColor="color.background.neutral">
                            <Inline space="space.200">
                              <Text size="small">Driver #{pit.driver_number}</Text>
                              <Text size="small">Lap {pit.lap_number}</Text>
                              <Text size="small">{pit.pit_duration?.toFixed(2)}s</Text>
                            </Inline>
                          </Box>
                        ))}
                      </Stack>
                    </>
                  )}
                </>
              )}
            </Stack>
          </Box>
        </TabPanel>

        {/* TAB 4: Lap Times */}
        <TabPanel>
          <Box padding="space.200">
            <Stack space="space.200">
              <Text size="large" weight="bold">Lap Times</Text>

              {!lapTimes || !lapTimes.laps || lapTimes.laps.length === 0 ? (
                <Text>No lap time data available</Text>
              ) : (
                <>
                  {lapTimes.bestLap && (
                    <Box padding="space.100" backgroundColor="color.background.success">
                      <Text weight="bold">
                        Best Lap: {lapTimes.bestLap.toFixed(3)}s
                      </Text>
                    </Box>
                  )}

                  <Stack space="space.100">
                    {lapTimes.laps.map((lap, idx) => {
                      const isBest = lap.lap_duration === lapTimes.bestLap;
                      const isPitLap = lap.is_pit_out_lap;

                      return (
                        <Box
                          key={idx}
                          padding="space.100"
                          backgroundColor={
                            isBest ? "color.background.success" :
                              isPitLap ? "color.background.warning" :
                                "color.background.neutral"
                          }
                        >
                          <Inline space="space.200" spread="space-between">
                            <Text weight={isBest ? "bold" : "regular"}>
                              Lap {lap.lap_number}
                            </Text>
                            <Text>
                              {lap.lap_duration ? `${lap.lap_duration.toFixed(3)}s` : 'No time'}
                            </Text>
                            {isPitLap && <Badge text="Pit Out" appearance="default" />}
                            {isBest && <Badge text="Best" appearance="success" />}
                          </Inline>
                        </Box>
                      );
                    })}
                  </Stack>
                </>
              )}
            </Stack>
          </Box>
        </TabPanel>
      </Tabs>
    </Box>
  );
};

ForgeReconciler.render(<App />);
