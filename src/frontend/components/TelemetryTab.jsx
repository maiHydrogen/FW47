import React from 'react';
import { Box, Stack, Inline, Heading, Text, Lozenge, SectionMessage, EmptyState, ProgressBar, Badge } from '@forge/react';

const TelemetryTab = ({ context, telemetry }) => {
  // Safe calculations with fallbacks
  const maxSpeed = telemetry && telemetry.length > 0
    ? Math.max(...telemetry.map(p => p.speed || 0).filter(s => s > 0))
    : 0;

  const maxRpm = telemetry && telemetry.length > 0
    ? Math.max(...telemetry.map(p => p.rpm || 0).filter(r => r > 0))
    : 0;

  return (
    <Box padding="space.300">
      <Stack space="space.250">
        <Inline space="space.100" alignBlock="center" spread="space-between">
          <Heading size="medium">
            Telemetry Analysis {context.lapNumber && `- Lap ${context.lapNumber}`}
          </Heading>
          {context.lapNumber && (
            <Lozenge appearance="inprogress" isBold>
              LAP {context.lapNumber}
            </Lozenge>
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
            {/* Summary Stats Bar */}
            <Box
              padding="space.200"
              backgroundColor="color.background.brand.bold"
            >
              <Inline space="space.400" spread="space-between">
                <Text size="small" color="color.text.inverse">
                  <Text weight="bold">{telemetry.length}</Text> data points captured
                </Text>
                {maxSpeed > 0 && (
                  <Text size="small" color="color.text.inverse">
                    Max Speed: <Text weight="bold">{maxSpeed} km/h</Text>
                  </Text>
                )}
                {maxRpm > 0 && (
                  <Text size="small" color="color.text.inverse">
                    Max RPM: <Text weight="bold">{maxRpm}</Text>
                  </Text>
                )}
              </Inline>
            </Box>
            {/* Speed Distribution Analysis - ADD THIS AFTER SUMMARY STATS */}
            <Box
              padding="space.200"
              backgroundColor="color.background.neutral"
              xcss={{ borderRadius: '4px' }}
            >
              <Stack space="space.150">
                <Heading size="xsmall">Speed Distribution Analysis</Heading>
                <Inline space="space.200">
                  {(() => {
                    const highSpeed = telemetry.filter(p => p.speed > 300).length;
                    const medSpeed = telemetry.filter(p => p.speed >= 200 && p.speed <= 300).length;
                    const lowSpeed = telemetry.filter(p => p.speed < 200).length;
                    const totalPoints = telemetry.length;

                    return (
                      <>
                        <Stack space="space.050" xcss={{ flex: 1 }}>
                          <Text size="small" weight="bold" color="color.text.success">
                            High Speed (&gt;300 km/h)
                          </Text>
                          <ProgressBar
                            value={highSpeed / totalPoints}
                            appearance="success"
                          />
                          <Text size="small" color="color.text.subtle">
                            {highSpeed} points ({((highSpeed / totalPoints) * 100).toFixed(1)}%)
                          </Text>
                        </Stack>

                        <Stack space="space.050" xcss={{ flex: 1 }}>
                          <Text size="small" weight="bold">
                            Medium Speed (200-300 km/h)
                          </Text>
                          <ProgressBar value={medSpeed / totalPoints} />
                          <Text size="small" color="color.text.subtle">
                            {medSpeed} points ({((medSpeed / totalPoints) * 100).toFixed(1)}%)
                          </Text>
                        </Stack>

                        <Stack space="space.050" xcss={{ flex: 1 }}>
                          <Text size="small" weight="bold" color="color.text.danger">
                            Low Speed (&lt;200 km/h)
                          </Text>
                          <ProgressBar value={lowSpeed / totalPoints} />
                          <Text size="small" color="color.text.subtle">
                            {lowSpeed} points ({((lowSpeed / totalPoints) * 100).toFixed(1)}%)
                          </Text>
                        </Stack>
                      </>
                    );
                  })()}
                </Inline>
              </Stack>
            </Box>
            
            {/* Cockpit View - Racing Dashboard Style */}
            <Stack space="space.200">
              {telemetry.slice(0, 12).map((point, idx) => {
                const speed = point.speed || 0;
                const rpm = point.rpm || 0;
                const throttle = point.throttle || 0;
                const brake = point.brake || 0;
                const gear = point.gear || 0;
                const drs = point.drs || 0;

                // Determine background color
                let bgColor = "color.background.neutral";
                let borderColor = "#37BEFF";

                if (speed > 300) {
                  bgColor = "color.background.success.subtle";
                  borderColor = "#00FF00";
                } else if (brake > 50) {
                  bgColor = "color.background.danger.subtle";
                  borderColor = "#FF0000";
                }

                return (
                  <Box
                    key={idx}
                    padding="space.250"
                    backgroundColor={bgColor}
                    xcss={{
                      borderRadius: '4px',
                      borderLeft: `4px solid ${borderColor}`
                    }}
                  >
                    <Stack space="space.150">
                      {/* Primary Metrics Row */}
                      <Inline space="space.400" spread="space-between">
                        {/* Speed Indicator */}
                        <Stack space="space.075">
                          <Text size="small" color="color.text.subtlest" weight="bold">
                            SPEED
                          </Text>
                          <Heading size="small">
                            {speed} <Text size="small">km/h</Text>
                          </Heading>
                        </Stack>

                        {/* RPM Indicator */}
                        <Stack space="space.075">
                          <Text size="small" color="color.text.subtlest" weight="bold">
                            RPM
                          </Text>
                          <Heading size="small">
                            {rpm}
                          </Heading>
                        </Stack>

                        {/* Gear Indicator */}
                        <Stack space="space.075">
                          <Text size="small" color="color.text.subtlest" weight="bold">
                            GEAR
                          </Text>
                          <Badge
                            text={gear > 0 ? gear.toString() : 'N'}
                            appearance="primary"
                          />
                        </Stack>

                        {/* DRS Status */}
                        {drs > 0 && (
                          <Stack space="space.075">
                            <Lozenge appearance="success" isBold>
                              DRS OPEN
                            </Lozenge>
                          </Stack>
                        )}
                      </Inline>

                      {/* Throttle & Brake Bars - Racing Style */}
                      <Inline space="space.300" spread="space-between">
                        <Box xcss={{ flex: 1 }}>
                          <Stack space="space.050">
                            <Inline space="space.100" spread="space-between">
                              <Text size="small" weight="bold" color="color.text.success">
                                THROTTLE
                              </Text>
                              <Text size="small" weight="bold">
                                {throttle}%
                              </Text>
                            </Inline>
                            <ProgressBar
                              value={Math.min(Math.max(throttle / 100, 0), 1)}
                              appearance="success"
                            />
                          </Stack>
                        </Box>

                        <Box xcss={{ flex: 1 }}>
                          <Stack space="space.050">
                            <Inline space="space.100" spread="space-between">
                              <Text size="small" weight="bold" color="color.text.danger">
                                BRAKE
                              </Text>
                              <Text size="small" weight="bold">
                                {brake}%
                              </Text>
                            </Inline>
                            <ProgressBar
                              value={Math.min(Math.max(brake / 100, 0), 1)}
                            />
                          </Stack>
                        </Box>
                      </Inline>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>

            {telemetry.length > 12 && (
              <Box
                padding="space.150"
                backgroundColor="color.background.neutral.subtle"
              >
                <Text size="small" align="center" color="color.text.subtle">
                  Showing first 12 of <Text weight="bold">{telemetry.length}</Text> optimized data points
                </Text>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default TelemetryTab;
