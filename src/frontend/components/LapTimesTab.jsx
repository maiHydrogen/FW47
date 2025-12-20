import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, EmptyState } from '@forge/react';

const LapTimesTab = ({ context, lapTimes }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Lap Analysis</Heading>
        
        {!lapTimes || !lapTimes.laps?.length ? (
          <EmptyState header="No Lap Data" description="Timing data unavailable." />
        ) : (
          <Stack space="space.200">
            {/* Header */}
            <Box paddingInline="space.200">
               <Inline spread="space-between">
                  <Text size="small" weight="bold" color="color.text.subtlest">LAP</Text>
                  <Text size="small" weight="bold" color="color.text.subtlest">TIME</Text>
                  <Text size="small" weight="bold" color="color.text.subtlest">DELTA</Text>
               </Inline>
            </Box>

            {/* Scrollable List - Full Width */}
            <Box xcss={{ width: '100%', maxHeight: '500px', overflowY: 'auto' }}>
                <Stack space="space.100">
                    {lapTimes.laps.map((lap, idx) => {
                    const isBest = lapTimes.bestLap && lap.lap_duration === lapTimes.bestLap;
                    
                    let delta = '-';
                    let deltaColor = "color.text.subtlest";
                    
                    if (lapTimes.bestLap && lap.lap_duration) {
                        const diff = lap.lap_duration - lapTimes.bestLap;
                        // Requirement #2: Red if positive (slower), Green if negative (faster - though rare vs best)
                        // Note: vs Best Lap, delta is always positive or 0. 
                        // If you compared to *previous* lap, it could be negative.
                        // Standard F1 delta to best is Red (+).
                        delta = isBest ? '-0.000' : `+${diff.toFixed(3)}`;
                        deltaColor = isBest ? "color.text.success" : "color.text.danger"; 
                    }
                    
                    return (
                        <Box 
                          key={idx} 
                          padding="space.200"
                          backgroundColor={isBest ? "color.background.success.subtle" : lap.is_pit_out_lap ? "color.background.warning.subtle" : "color.background.neutral"}
                          xcss={{ borderRadius: '4px', width: '100%' }}
                        >
                          <Inline spread="space-between" alignBlock="center">
                              <Text weight="medium">Lap {lap.lap_number}</Text>
                              
                              <Heading size="small">
                                  {typeof lap.lap_duration === 'number' ? `${lap.lap_duration.toFixed(3)}s` : 'PIT / OUT'}
                              </Heading>
                              
                              <Text color={deltaColor} weight="bold">{delta}</Text>
                          </Inline>
                        </Box>
                    );
                    })}
                </Stack>
            </Box>
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default LapTimesTab;