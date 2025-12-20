import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge } from '@forge/react';

const Header = ({ context, lapTimes }) => {
  return (
    <Box 
      padding="space.300" 
      backgroundColor="color.background.brand.bold"
      xcss={{
        borderBottom: '4px solid #00A0E2' // Williams Cyan Accent
      }}
    >
      <Stack space="space.200">
        {/* Top Bar: Title + Live Status */}
        <Inline space="space.200" alignBlock="center" spread="space-between">
          <Inline space="space.150" alignBlock="center">
            <Heading size="medium">
              <Text color="color.text.inverse">FW47 RACE OPERATIONS</Text>
            </Heading>
            <Badge appearance="primary" text="WILLIAMS RACING" />
          </Inline>
          
          {/* Live Indicator */}
          <Lozenge appearance="success" isBold>● LIVE TELEMETRY</Lozenge>
        </Inline>
        
        {/* Metrics Dashboard - Full Width "Glass" Effect */}
        <Box 
          padding="space.300" 
          backgroundColor="color.background.neutral"
          borderRadius="border.radius.100"
        >
          {/* Responsive Grid: Stacks on small screens, spreads on wide */}
          <Inline space="space.400" spread="space-between" alignBlock="center" shouldWrap>
            
            {/* Driver */}
            <Stack space="space.0">
              <Text size="small" color="color.text.inverse" weight="bold">DRIVER</Text>
              <Inline space="space.100" alignBlock="center">
                <Heading color="color.text.inverse" size="medium">{context.driverName}</Heading>
                <Badge text={`#${context.driverNumber}`} appearance="primary" />
              </Inline>
            </Stack>
            
            {/* Session */}
            <Stack space="space.0">
              <Text size="small" color="color.text.inverse" weight="bold">SESSION</Text>
              <Inline space="space.100" alignBlock="center">
                <Text color="color.text.inverse" size="medium" weight="medium">{context.sessionName}</Text>
                <Lozenge>{context.sessionType}</Lozenge>
              </Inline>
            </Stack>
            
            {/* Circuit */}
            <Stack space="space.0">
              <Text size="small" color="color.text.inverse" weight="bold">LOCATION</Text>
              <Text color="color.text.inverse" size="medium" weight="medium">{context.location}</Text>
            </Stack>
            
            {/* Best Lap Highlight */}
            {lapTimes?.bestLap && (
              <Box paddingInline="space.200" paddingBlock="space.100" backgroundColor="color.background.success.subtle" borderRadius="border.radius.100">
                <Stack space="space.0">
                  <Text size="small" color="color.text.inverse" weight="bold">FASTEST LAP</Text>
                  <Text weight="bold" color="color.text.success" size="medium">{lapTimes.bestLap.toFixed(3)}s</Text>
                </Stack>
              </Box>
            )}

          </Inline>
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;