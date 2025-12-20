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
            {/* Best Lap Hero Section */}
            {lapTimes.bestLap && (
              <Box 
                padding="space.300" 
                backgroundColor="color.background.success.bold"
                xcss={{
                  borderRadius: '6px',
                  border: '2px solid #00FF00'
                }}
              >
                <Inline space="space.200" alignBlock="center" spread="space-between">
                  <Stack space="space.100">
                    <Text size="small" color="color.text.inverse.subtle">
                      PERSONAL BEST LAP TIME
                    </Text>
                    <Heading size="xlarge" color="color.text.inverse">
                      {lapTimes.bestLap.toFixed(3)}<Text size="medium">s</Text>
                    </Heading>
                  </Stack>
                  <Lozenge appearance="success" isBold>
                    🏆 FASTEST
                  </Lozenge>
                </Inline>
              </Box>
            )}
            
            {/* Lap Times Grid */}
            <Box 
              padding="space.250" 
              backgroundColor="color.background.neutral.bold"
              xcss={{
                borderRadius: '4px',
                maxHeight: '500px',
                overflow: 'auto'
              }}
            >
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
                        isPitLap ? "color.background.warning" : 
                        idx % 2 === 0 ? "color.background.neutral" : "color.background.input"
                      }
                      xcss={{
                        borderRadius: '4px',
                        borderLeft: '4px solid',
                        borderColor: isBest ? '#00FF00' : isPitLap ? '#FFA500' : '#37BEFF'
                      }}
                    >
                      <Inline space="space.200" spread="space-between" alignBlock="center">
                        <Inline space="space.200" alignBlock="center">
                          {/* Lap Number */}
                          <Box xcss={{minWidth: '80px'}}>
                            <Text 
                              weight={isBest ? "bold" : "medium"}
                              size="medium"
                              color={isBest ? "color.text.inverse" : undefined}
                            >
                              LAP {lap.lap_number}
                            </Text>
                          </Box>
                          
                          {/* Lap Time */}
                          <Box xcss={{minWidth: '120px'}}>
                            <Text 
                              weight={isBest ? "bold" : "regular"}
                              size={isBest ? "large" : "medium"}
                              color={isBest ? "color.text.inverse" : undefined}
                            >
                              {lap.lap_duration ? `${lap.lap_duration.toFixed(3)}s` : 'No time'}
                            </Text>
                          </Box>
                          
                          {/* Delta */}
                          {delta && !isBest && (
                            <Text 
                              size="small" 
                              color={parseFloat(delta) < 0.5 ? "color.text.warning" : "color.text.subtle"}
                            >
                              +{delta}s
                            </Text>
                          )}
                        </Inline>
                        
                        {/* Status Badges */}
                        <Inline space="space.100">
                          {isPitLap && (
                            <Badge text="PIT OUT" appearance="default" />
                          )}
                          {isBest && (
                            <Badge text="⚡ BEST" appearance="added" />
                          )}
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
