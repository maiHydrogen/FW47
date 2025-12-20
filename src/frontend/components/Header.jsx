import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge } from '@forge/react';

const Header = ({ context, lapTimes }) => {
  return (
    <Box padding="space.300" backgroundColor="color.background.brand.bold">
      <Stack space="space.200">
        <Inline space="space.200" alignBlock="center" spread="space-between">
          <Heading size="medium">FW47 Race Operations</Heading>
          <Lozenge appearance="success" isBold>LIVE DATA</Lozenge>
        </Inline>
        
        <Box padding="space.200" backgroundColor="color.background.neutral">
          <Inline space="space.400" spread="space-between">
            <Stack space="space.050">
              <Text size="small">DRIVER</Text>
              <Inline space="space.100" alignBlock="center">
                <Heading size="small">{context.driverName}</Heading>
                <Badge text={`#${context.driverNumber}`} appearance="primary" />
              </Inline>
            </Stack>
            
            <Stack space="space.050">
              <Text size="small">SESSION</Text>
              <Inline space="space.100" alignBlock="center">
                <Text weight="bold">{context.sessionName}</Text>
                <Lozenge>{context.sessionType}</Lozenge>
              </Inline>
            </Stack>
            
            <Stack space="space.050">
              <Text size="small">CIRCUIT</Text>
              <Text weight="bold">{context.location}</Text>
            </Stack>
            
            {lapTimes?.bestLap && (
              <Stack space="space.050">
                <Text size="small">BEST LAP</Text>
                <Text weight="bold">{lapTimes.bestLap.toFixed(3)}s</Text>
              </Stack>
            )}
          </Inline>
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;
