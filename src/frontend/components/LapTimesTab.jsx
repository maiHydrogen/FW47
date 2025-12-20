import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, EmptyState } from '@forge/react';

const LapTimesTab = ({ context, lapTimes }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.300" alignInline="stretch">
        <Heading size="medium">Lap Analysis</Heading>
        
        {!lapTimes || !lapTimes.laps?.length ? (
          <EmptyState header="No Lap Data" description="Timing data unavailable." />
        ) : (
          <Stack space="space.200" alignInline="stretch">
            {/* Header Row */}
            <Box paddingInline="space.200">
               <Inline spread="space-between">
                  <Text size="small" weight="bold" color="color.text.subtlest">LAP</Text>
                  <Text size="small" weight="bold" color="color.text.subtlest">TIME</Text>
                  <Text size="small" weight="bold" color="color.text.subtlest">DELTA</Text>
               </Inline>
            </Box>

            {/* Scrollable List - Full Width */}
            <Box xcss={{ width: '100%', maxHeight: '500px', overflowY: 'auto' }}>
                <Stack space="space.100" alignInline="stretch">
                    {lapTimes.laps.map((lap, idx) => {
                    const isBest = lapTimes.bestLap && lap.lap_duration === lapTimes.bestLap;
                    
                    let delta = '-';
                    let deltaColor = "color.text.subtlest";
                    
                    if (lapTimes.bestLap && lap.lap_duration) {
                        const diff = lap.lap_duration - lapTimes.bestLap;
                        delta = isBest ? '-0.000' : `+${diff.toFixed(3)}`;
                        // Green if negative (faster), Red if positive (slower)
                        deltaColor = diff < 0 ? "color.text.success" : isBest ? "color.text.success" : "color.text.danger";
                    }
                    
                    return (
                        <Box 
                          key={idx} 
                          padding="space.200"
                          backgroundColor={isBest ? "color.background.success.subtle" : lap.is_pit_out_lap ? "color.background.warning.subtle" : "color.background.neutral"}
                          xcss={{ borderRadius: '4px' }}
                        >
                          <Inline spread="space-between" alignBlock="center">
                              <Box xcss={{ minWidth: '60px' }}>
                                <Text weight="medium">Lap {lap.lap_number}</Text>
                              </Box>
                              
                              <Heading size="small">
                                  {typeof lap.lap_duration === 'number' ? `${lap.lap_duration.toFixed(3)}s` : 'PIT / OUT'}
                              </Heading>
                              
                              <Box xcss={{ minWidth: '60px', textAlign: 'right' }}>
                                <Text color={deltaColor} weight="bold" align="end">{delta}</Text>
                              </Box>
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