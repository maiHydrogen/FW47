import React from 'react';
import { Box, Stack, Inline, Heading, Text, Lozenge, SectionMessage, EmptyState, ProgressBar } from '@forge/react';

const TelemetryTab = ({ context, telemetry }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.250">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Heading size="medium">
            Telemetry Data {context.lapNumber && `- Lap ${context.lapNumber}`}
          </Heading>
          {context.lapNumber && (
            <Lozenge appearance="inprogress">LAP {context.lapNumber}</Lozenge>
          )}
        </Inline>
        
        {!context.lapNumber ? (
          <SectionMessage appearance="warning" title="Lap Selection Required">
            <Text>Add a <Text weight="bold">lap-XX</Text> label to this ticket to load telemetry data.</Text>
          </SectionMessage>
        ) : !telemetry || telemetry.length === 0 ? (
          <EmptyState
            header="No Telemetry Available"
            description="Telemetry data not found for the selected lap."
          />
        ) : (
          <>
            <Box padding="space.150" backgroundColor="color.background.success.subtle">
              <Text size="small">
                <Text weight="bold">{telemetry.length} data points</Text> captured for analysis
              </Text>
            </Box>
            
            <Stack space="space.150">
              {telemetry.slice(0, 15).map((point, idx) => (
                <Box 
                  key={idx} 
                  padding="space.200" 
                  backgroundColor={idx % 2 === 0 ? "color.background.neutral" : "color.background.input"}
                >
                  <Inline space="space.300" spread="space-between">
                    <Stack space="space.050">
                      <Text size="small">SPEED</Text>
                      <Text weight="bold">{point.speed || 'N/A'} km/h</Text>
                    </Stack>
                    
                    <Stack space="space.050">
                      <Text size="small">THROTTLE</Text>
                      <ProgressBar value={(point.throttle || 0) / 100} />
                      <Text size="small">{point.throttle || 0}%</Text>
                    </Stack>
                    
                    <Stack space="space.050">
                      <Text size="small">BRAKE</Text>
                      <ProgressBar value={(point.brake || 0) / 100} />
                      <Text size="small">{point.brake || 0}%</Text>
                    </Stack>
                    
                    <Stack space="space.050">
                      <Text size="small">RPM</Text>
                      <Text weight="bold">{point.rpm || 'N/A'}</Text>
                    </Stack>
                  </Inline>
                </Box>
              ))}
            </Stack>
            
            {telemetry.length > 15 && (
              <Text size="small" align="center">
                Showing first 15 of <Text weight="bold">{telemetry.length}</Text> data points
              </Text>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default TelemetryTab;
