import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState, ProgressBar } from '@forge/react';

const PitStrategyTab = ({ context, pitStrategy }) => {
  // Helper to get compound color
  const getCompoundColor = (compound) => {
     const c = (compound || '').toUpperCase();
     if (c === 'SOFT') return '#FF3232'; // Red
     if (c === 'MEDIUM') return '#FFD700'; // Yellow
     if (c === 'HARD') return '#DDDDDD'; // White
     return '#37BEFF'; // Inter/Wet/Unknown
  };

  // Calculate Average Pit Duration across ALL drivers for comparison
  const avgPitDuration = pitStrategy?.allPitStops?.length 
    ? (pitStrategy.allPitStops.reduce((sum, p) => sum + (p.pit_duration || 0), 0) / pitStrategy.allPitStops.length)
    : 0;

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Pit Strategy & Tire Management</Heading>
        
        {!pitStrategy || pitStrategy.stints?.length === 0 ? (
          <EmptyState header="No Strategy Data" description="Pit stop information unavailable." />
        ) : (
          <>
            {/* Requirement #4: Tire Compound History */}
            <Box padding="space.250" backgroundColor="color.background.neutral" xcss={{ borderRadius: '8px' }}>
               <Stack space="space.200">
                  <Heading size="small">Stint History (Tyre Evolution)</Heading>
                  <Inline space="space.200" shouldWrap>
                     {pitStrategy.stints.map((stint, idx) => (
                        <Box 
                           key={idx}
                           padding="space.200" 
                           backgroundColor="color.background.neutral.subtle"
                           xcss={{ 
                              borderBottom: `4px solid ${getCompoundColor(stint.compound)}`,
                              borderRadius: '4px',
                              minWidth: '120px'
                           }}
                        >
                           <Stack space="space.050">
                              <Text size="small" weight="bold">STINT {stint.stint_number}</Text>
                              <Badge text={stint.compound || 'UNKNOWN'} />
                              <Text size="small" color="color.text.subtlest">
                                 Laps {stint.lap_start}-{stint.lap_end || 'Now'}
                              </Text>
                           </Stack>
                        </Box>
                     ))}
                  </Inline>
               </Stack>
            </Box>

            {/* Requirement #3: Pit Stop Comparison */}
            {pitStrategy.driverPitStops?.map((pit, idx) => {
               const duration = pit.pit_duration || 0;
               const diffToAvg = duration - avgPitDuration;
               const isFaster = diffToAvg < 0;

               return (
                 <Box key={idx} padding="space.200" backgroundColor="color.background.neutral" xcss={{ borderRadius: '8px' }}>
                    <Stack space="space.150">
                       <Inline spread="space-between">
                          <Heading size="small">Pit Stop {idx + 1} (Lap {pit.lap_number})</Heading>
                          <Lozenge appearance={isFaster ? "success" : "removed"}>
                             {isFaster ? "FASTER THAN AVG" : "SLOWER THAN AVG"}
                          </Lozenge>
                       </Inline>
                       
                       {/* Visual Comparison Bar */}
                       <Stack space="space.050">
                          <Inline spread="space-between">
                             <Text size="small">Driver: <Text weight="bold">{duration.toFixed(2)}s</Text></Text>
                             <Text size="small" color="color.text.subtlest">Field Avg: {avgPitDuration.toFixed(2)}s</Text>
                          </Inline>
                          <ProgressBar value={duration > 0 ? (avgPitDuration / duration) * 0.5 : 0} />
                          <Text size="small" color={isFaster ? "color.text.success" : "color.text.danger"}>
                             {Math.abs(diffToAvg).toFixed(2)}s {isFaster ? "faster" : "slower"} than field average
                          </Text>
                       </Stack>
                    </Stack>
                 </Box>
               );
            })}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default PitStrategyTab;