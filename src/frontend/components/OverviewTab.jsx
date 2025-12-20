import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge } from '@forge/react';
import { calculateSessionStats } from '../../utils/calculations';

const OverviewTab = ({ context, lapTimes, pitStrategy }) => {
  const stats = calculateSessionStats(lapTimes, pitStrategy);

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        {/* Session Statistics Card */}
        <Box padding="space.250" backgroundColor="color.background.neutral">
          <Stack space="space.200">
            <Heading size="small">Session Statistics</Heading>
            
            <Inline space="space.400">
              <Stack space="space.050">
                <Text size="small">Total Laps</Text>
                <Heading size="medium">{stats.totalLaps}</Heading>
              </Stack>
              
              <Stack space="space.050">
                <Text size="small">Valid Laps</Text>
                <Heading size="medium">{stats.validLaps}</Heading>
              </Stack>
              
              <Stack space="space.050">
                <Text size="small">Avg Lap Time</Text>
                <Heading size="medium">{stats.avgLapTime}s</Heading>
              </Stack>
              
              <Stack space="space.050">
                <Text size="small">Pit Stops</Text>
                <Heading size="medium">{stats.pitStops}</Heading>
              </Stack>
            </Inline>
          </Stack>
        </Box>

        {/* Driver Information Card */}
        <Box padding="space.250" backgroundColor="color.background.information">
          <Stack space="space.200">
            <Heading size="small">Driver Profile</Heading>
            
            <Stack space="space.100">
              <Inline space="space.200" spread="space-between">
                <Text weight="medium">Full Name</Text>
                <Text>{context.driverName}</Text>
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium">Car Number</Text>
                <Text>#{context.driverNumber}</Text>
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium">Session ID</Text>
                <Text size="small">{context.sessionKey}</Text>
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium">Jira Ticket</Text>
                <Badge text={context.issueKey} />
              </Inline>
            </Stack>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default OverviewTab;
