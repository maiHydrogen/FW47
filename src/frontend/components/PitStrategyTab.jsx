import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState } from '@forge/react';

const PitStrategyTab = ({ context, pitStrategy }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Pit Stop Strategy</Heading>
        
        {!pitStrategy || pitStrategy.stints?.length === 0 ? (
          <EmptyState
            header="No Strategy Data"
            description="Pit stop and stint information unavailable."
          />
        ) : (
          <>
            {/* Tire Stints */}
            <Box padding="space.250" backgroundColor="color.background.neutral">
              <Stack space="space.200">
                <Heading size="small">Tire Stints</Heading>
                
                <Stack space="space.150">
                  {pitStrategy.stints.map((stint, idx) => {
                    const stintLength = stint.lap_end - stint.lap_start + 1;
                    const isCurrentStint = idx === pitStrategy.stints.length - 1;
                    
                    return (
                      <Box 
                        key={idx} 
                        padding="space.200"
                        backgroundColor={isCurrentStint ? "color.background.success.subtle" : "color.background.input"}
                      >
                        <Stack space="space.100">
                          <Inline space="space.150" alignBlock="center" spread="space-between">
                            <Inline space="space.100" alignBlock="center">
                              <Heading size="xsmall">Stint {stint.stint_number}</Heading>
                              {isCurrentStint && <Lozenge appearance="success">CURRENT</Lozenge>}
                            </Inline>
                            <Badge text={stint.compound || 'Unknown'} />
                          </Inline>
                          
                          <Inline space="space.400">
                            <Text size="small">
                              Laps <Text weight="bold">{stint.lap_start}</Text> → <Text weight="bold">{stint.lap_end}</Text>
                            </Text>
                            <Text size="small">({stintLength} laps)</Text>
                          </Inline>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Stack>
            </Box>
            
            {/* All Pit Stops */}
            {pitStrategy.allPitStops?.length > 0 && (
              <Box padding="space.250" backgroundColor="color.background.information.subtle">
                <Stack space="space.200">
                  <Heading size="small">All Pit Stops</Heading>
                  
                  <Stack space="space.100">
                    {pitStrategy.allPitStops.map((pit, idx) => (
                      <Box key={idx} padding="space.150" backgroundColor="color.background.neutral">
                        <Inline space="space.200" spread="space-between">
                          <Badge text={`#${pit.driver_number}`} />
                          <Text>Lap {pit.lap_number}</Text>
                          <Text weight="bold">{pit.pit_duration?.toFixed(2)}s</Text>
                        </Inline>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default PitStrategyTab;
