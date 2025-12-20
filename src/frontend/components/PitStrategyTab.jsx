import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState } from '@forge/react';

const PitStrategyTab = ({ context, pitStrategy }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Pit Strategy</Heading>
        
        {!pitStrategy || pitStrategy.stints?.length === 0 ? (
          <EmptyState header="No Strategy Data" description="Stint information unavailable." />
        ) : (
          <Stack space="space.200">
            {pitStrategy.stints.map((stint, idx) => {
              const isCurrent = idx === pitStrategy.stints.length - 1;
              const stintLength = stint.lap_end ? (stint.lap_end - stint.lap_start + 1) : 'Ongoing';
              
              // Dynamic Border Color based on Compound
              const borderColor = stint.compound === 'SOFT' ? '#FF3232' : stint.compound === 'HARD' ? '#DDDDDD' : '#FFD700'; // Red/White/Yellow

              return (
                <Box 
                  key={idx} 
                  padding="space.300"
                  backgroundColor={isCurrent ? "color.background.neutral" : "color.background.neutral.subtle"}
                  xcss={{
                    borderLeft: `6px solid ${borderColor}`,
                    borderRadius: '4px'
                  }}
                >
                  <Inline spread="space-between" alignBlock="center">
                    
                    {/* Left: Stint Info */}
                    <Stack space="space.0">
                      <Inline space="space.100" alignBlock="center">
                        <Heading size="small">Stint {stint.stint_number}</Heading>
                        {isCurrent && <Lozenge appearance="success" isBold>ACTIVE</Lozenge>}
                      </Inline>
                      <Text size="small" color="color.text.subtlest">
                        Laps {stint.lap_start} → {stint.lap_end || 'Now'} • {stintLength} Laps
                      </Text>
                    </Stack>

                    {/* Right: Compound Badge */}
                    <Badge appearance="primary" text={stint.compound || 'UNKNOWN'} />

                  </Inline>
                </Box>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default PitStrategyTab;