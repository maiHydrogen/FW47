import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge } from '@forge/react';
import { calculateSessionStats } from '../../utils/calculations';

const OverviewTab = ({ context, lapTimes, pitStrategy }) => {
  const stats = calculateSessionStats(lapTimes, pitStrategy);

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        
        {/* KPI Row - Fully Responsive */}
        <Inline space="space.200" spread="space-between" shouldWrap>
            {/* Card 1: Laps */}
            <Box padding="space.300" backgroundColor="color.background.neutral" xcss={{ flex: 1, minWidth: '200px' }}>
              <Stack space="space.100" alignInline="start">
                 <Text size="small" color="color.text.subtlest" weight="bold">TOTAL LAPS</Text>
                 <Heading size="large">{stats.totalLaps}</Heading>
                 <Text size="small" color="color.text.subtle">Valid: {stats.validLaps}</Text>
              </Stack>
            </Box>

            {/* Card 2: Pace */}
            <Box padding="space.300" backgroundColor="color.background.neutral" xcss={{ flex: 1, minWidth: '200px' }}>
              <Stack space="space.100" alignInline="start">
                 <Text size="small" color="color.text.subtlest" weight="bold">AVG PACE</Text>
                 <Heading size="large">{stats.avgLapTime}s</Heading>
                 <Text size="small" color="color.text.success">Consistent</Text>
              </Stack>
            </Box>

            {/* Card 3: Pits */}
            <Box padding="space.300" backgroundColor="color.background.neutral" xcss={{ flex: 1, minWidth: '200px' }}>
              <Stack space="space.100" alignInline="start">
                 <Text size="small" color="color.text.subtlest" weight="bold">PIT STOPS</Text>
                 <Heading size="large">{stats.pitStops}</Heading>
                 <Badge appearance="primary" text="Strategy Active" />
              </Stack>
            </Box>
        </Inline>

        {/* Details Section */}
        <Box padding="space.300" backgroundColor="color.background.neutral" xcss={{ borderLeft: '4px solid #00A0E2' }}>
          <Stack space="space.200">
            <Heading size="small">Session Context</Heading>
            <Inline spread="space-between">
               <Text color="color.text.subtle">Session ID:</Text>
               <Text>{context.sessionKey}</Text>
            </Inline>
            <Inline spread="space-between">
               <Text color="color.text.subtle">Jira Ticket:</Text>
               <Text weight="bold">{context.issueKey}</Text>
            </Inline>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default OverviewTab;