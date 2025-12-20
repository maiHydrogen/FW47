import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge } from '@forge/react';

const Header = ({ context, lapTimes }) => {
  return (
    <Box 
      padding="space.300" 
      backgroundColor="color.background.brand.bold.pressed"
      xcss={{
        borderBottom: '3px solid #37BEFF'
      }}
    >
      <Stack space="space.200">
        {/* Top Bar: Title + Live Status */}
        <Inline space="space.200" alignBlock="center" spread="space-between">
          <Inline space="space.150" alignBlock="center">
            <Heading size="large" color="color.text.inverse">
              FW47 RACE OPERATIONS
            </Heading>
            <Text size="small" color="color.text.inverse.subtle">
              Powered by Williams Racing
            </Text>
          </Inline>
          
          {/* Live Indicator - Racing Style */}
          <Inline space="space.100" alignBlock="center">
            <Box 
              xcss={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#00FF00',
                animation: 'pulse 1.5s infinite'
              }}
            />
            <Text size="small" color="color.text.inverse" weight="bold">
              LIVE DATA
            </Text>
          </Inline>
        </Inline>
        
        {/* Metrics Dashboard */}
        <Box 
          padding="space.250" 
          backgroundColor="color.background.neutral.bold"
          xcss={{
            borderRadius: '4px',
            borderLeft: '4px solid #37BEFF'
          }}
        >
          <Inline space="space.500" spread="space-between">
            {/* Driver Info */}
            <Stack space="space.050">
              <Text size="small" color="color.text.subtlest" weight="bold">
                DRIVER
              </Text>
              <Inline space="space.100" alignBlock="center">
                <Heading size="small">{context.driverName}</Heading>
                <Badge 
                  text={`#${context.driverNumber}`} 
                  appearance="primary"
                />
              </Inline>
            </Stack>
            
            {/* Session Info */}
            <Stack space="space.050">
              <Text size="small" color="color.text.subtlest" weight="bold">
                SESSION
              </Text>
              <Inline space="space.100" alignBlock="center">
                <Text weight="bold" size="medium">{context.sessionName}</Text>
                <Lozenge appearance="inprogress" isBold>
                  {context.sessionType}
                </Lozenge>
              </Inline>
            </Stack>
            
            {/* Circuit */}
            <Stack space="space.050">
              <Text size="small" color="color.text.subtlest" weight="bold">
                CIRCUIT
              </Text>
              <Text weight="bold" size="medium">{context.location}</Text>
            </Stack>
            
            {/* Best Lap - Highlight */}
            {lapTimes?.bestLap && (
              <Stack space="space.050">
                <Text size="small" color="color.text.subtlest" weight="bold">
                  BEST LAP
                </Text>
                <Text 
                  weight="bold" 
                  size="large"
                  color="color.text.success"
                >
                  {lapTimes.bestLap.toFixed(3)}s
                </Text>
              </Stack>
            )}
          </Inline>
        </Box>
      </Stack>
    </Box>
  );
};

export default Header;
