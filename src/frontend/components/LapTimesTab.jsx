import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState } from '@forge/react';

const LapTimesTab = ({ context, lapTimes }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.250">
        <Heading size="medium">Lap Time Analysis</Heading>
        
        {!lapTimes || !lapTimes.laps || lapTimes.laps.length === 0 ? (
          <EmptyState
            header="No Lap Data"
            description="Lap timing information is not available."
          />
        ) : (
          <>
            {/* Best Lap Highlight */}
            {lapTimes.bestLap && (
              <Box padding="space.250" backgroundColor="color.background.success.bold">
                <Inline space="space.200" alignBlock="center" spread="space-between">
                  <Stack space="space.050">
                    <Text size="small">BEST LAP TIME</Text>
                    <Heading size="large">{lapTimes.bestLap.toFixed(3)}s</Heading>
                  </Stack>
                  <Lozenge appearance="success" isBold>PERSONAL BEST</Lozenge>
                </Inline>
              </Box>
            )}
            
            {/* Lap Times List */}
            <Box padding="space.250" backgroundColor="color.background.neutral">
              <Stack space="space.150">
                {lapTimes.laps.map((lap, idx) => {
                  const isBest = lap.lap_duration === lapTimes.bestLap;
                  const isPitLap = lap.is_pit_out_lap;
                  const delta = lapTimes.bestLap && lap.lap_duration 
                    ? (lap.lap_duration - lapTimes.bestLap).toFixed(3)
                    : null;
                  
                  return (
                    <Box 
                      key={idx} 
                      padding="space.200"
                      backgroundColor={
                        isBest ? "color.background.success" : 
                        isPitLap ? "color.background.warning.subtle" : 
                        "color.background.input"
                      }
                    >
                      <Inline space="space.200" spread="space-between" alignBlock="center">
                        <Inline space="space.150" alignBlock="center">
                          <Text weight={isBest ? "bold" : "medium"}>
                            Lap {lap.lap_number}
                          </Text>
                          
                          <Text weight={isBest ? "bold" : "regular"}>
                            {lap.lap_duration ? `${lap.lap_duration.toFixed(3)}s` : 'No time'}
                          </Text>
                          
                          {delta && !isBest && (
                            <Text size="small">+{delta}s</Text>
                          )}
                        </Inline>
                        
                        <Inline space="space.100">
                          {isPitLap && <Badge text="PIT OUT" />}
                          {isBest && <Badge text="BEST" appearance="added" />}
                        </Inline>
                      </Inline>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          </>
        )}
      </Stack>
    </Box>
  );
};

export default LapTimesTab;
