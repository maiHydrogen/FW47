import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState, ProgressBar } from '@forge/react';

const PitStrategyTab = ({ context, pitStrategy }) => {
  const getCompoundBg = (compound) => {
     const c = (compound || '').toUpperCase();
     if (c === 'SOFT') return 'color.background.danger.subtle';
     if (c === 'MEDIUM') return 'color.background.warning.subtle';
     return 'color.background.neutral';
  };

  // Calculate Average Pit Duration
  const allPits = pitStrategy?.allPitStops || [];
  const validPits = allPits.filter(p => p.pit_duration && p.pit_duration < 40); // Filter out garage stops (>40s)
  const avgPitDuration = validPits.length > 0
    ? (validPits.reduce((sum, p) => sum + p.pit_duration, 0) / validPits.length)
    : 0;

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Pit Strategy</Heading>
        
        {!pitStrategy || pitStrategy.stints?.length === 0 ? (
          <EmptyState header="No Strategy Data" description="Pit stop information unavailable." />
        ) : (
          <>
            {/* Stints */}
            <Box padding="space.200" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'border.radius' }}>
               <Heading size="small">Stint History</Heading>
               <Inline space="space.200" shouldWrap>
                  {pitStrategy.stints.map((stint, idx) => (
                    <Box 
                       key={idx} 
                       padding="space.200" 
                       backgroundColor={getCompoundBg(stint.compound)}
                       xcss={{ borderRadius: 'border.radius', minWidth: '100px' }}
                    >
                       <Stack space="space.050">
                          <Text size="small" weight="bold">STINT {stint.stint_number}</Text>
                          <Badge text={stint.compound || 'UNK'} />
                          <Text size="small">Laps {stint.lap_start}-{stint.lap_end || 'Now'}</Text>
                       </Stack>
                    </Box>
                  ))}
               </Inline>
            </Box>

            {/* Comparison */}
            <Heading size="small">Pit Performance (Field Avg: {avgPitDuration.toFixed(2)}s)</Heading>
            
            {pitStrategy.driverPitStops?.map((pit, idx) => {
               const duration = pit.pit_duration || 0;
               const diff = duration - avgPitDuration;
               const isFaster = diff < 0;

               return (
                 <Box key={idx} padding="space.200" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'border.radius' }}>
                    <Stack space="space.150">
                       <Inline spread="space-between" alignBlock="center">
                          <Heading size="small">Stop {idx + 1} (Lap {pit.lap_number})</Heading>
                          <Lozenge appearance={isFaster ? "success" : "removed"}>
                             {isFaster ? "FASTER" : "SLOWER"}
                          </Lozenge>
                       </Inline>
                       
                       <Stack space="space.050">
                          <Inline spread="space-between">
                             <Text size="small"><Text weight="bold">{duration.toFixed(2)}s</Text></Text>
                             <Text size="small" color={isFaster ? "color.text.success" : "color.text.danger"}>
                                {Math.abs(diff).toFixed(2)}s {isFaster ? "faster" : "slower"}
                             </Text>
                          </Inline>
                          <ProgressBar value={duration > 0 ? (avgPitDuration / duration) * 0.5 : 0} />
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