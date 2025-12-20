import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, ProgressBar } from '@forge/react';
import { calculateSessionStats } from '../../utils/calculations';

const OverviewTab = ({ context, lapTimes, pitStrategy }) => {
  const stats = calculateSessionStats(lapTimes, pitStrategy);

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        {/* Session Statistics Card */}
        <Box 
          padding="space.250" 
          backgroundColor="color.background.neutral.bold"
          xcss={{
            borderRadius: '4px',
            borderLeft: '4px solid #37BEFF'
          }}
        >
          <Stack space="space.200">
            <Inline space="space.100" alignBlock="center" spread="space-between">
              <Heading size="small">Session Statistics</Heading>
              <Lozenge appearance="success">LIVE</Lozenge>
            </Inline>
            
            <Inline space="space.400" spread="space-between">
              <Stack space="space.100">
                <Text size="small" color="color.text.subtlest" weight="bold">
                  TOTAL LAPS
                </Text>
                <Heading size="large">{stats.totalLaps}</Heading>
                <Text size="small" color="color.text.subtle">
                  {stats.validLaps} valid laps
                </Text>
              </Stack>
              
              <Stack space="space.100">
                <Text size="small" color="color.text.subtlest" weight="bold">
                  AVG LAP TIME
                </Text>
                <Heading size="large">{stats.avgLapTime}s</Heading>
              </Stack>
              
              <Stack space="space.100">
                <Text size="small" color="color.text.subtlest" weight="bold">
                  PIT STOPS
                </Text>
                <Heading size="large">{stats.pitStops}</Heading>
                {stats.pitStops > 0 && pitStrategy?.stints?.[0] && (
                  <Badge text={pitStrategy.stints[pitStrategy.stints.length - 1].compound} />
                )}
              </Stack>
              
              {lapTimes?.bestLap && (
                <Stack space="space.100">
                  <Text size="small" color="color.text.subtlest" weight="bold">
                    BEST LAP
                  </Text>
                  <Heading size="large" color="color.text.success">
                    {lapTimes.bestLap.toFixed(3)}s
                  </Heading>
                  <Badge text="⚡ FASTEST" appearance="added" />
                </Stack>
              )}
            </Inline>
          </Stack>
        </Box>

        {/* Driver Information Card */}
        <Box 
          padding="space.250" 
          backgroundColor="color.background.neutral"
          xcss={{borderRadius: '4px'}}
        >
          <Stack space="space.200">
            <Inline space="space.100" alignBlock="center" spread="space-between">
              <Heading size="small">Driver Profile</Heading>
              <Badge text="Williams Racing" appearance="primary" />
            </Inline>
            
            <Stack space="space.100">
              <Inline space="space.200" spread="space-between">
                <Text weight="medium" color="color.text.subtle">Full Name</Text>
                <Text weight="bold">{context.driverName}</Text>
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium" color="color.text.subtle">Car Number</Text>
                <Badge text={`#${context.driverNumber}`} appearance="primary" />
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium" color="color.text.subtle">Session ID</Text>
                <Text size="small">{context.sessionKey}</Text>
              </Inline>
              <Inline space="space.200" spread="space-between">
                <Text weight="medium" color="color.text.subtle">Jira Ticket</Text>
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
