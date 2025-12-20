import React from 'react';
import { Box, Stack, Inline, Heading, Text, Badge, Lozenge, EmptyState } from '@forge/react';
import { classifyPitStop } from '../../utils/calculations';

// F1 Tire Compound Colors (Official)
const COMPOUND_COLORS = {
  'SOFT': { bg: 'color.background.danger.subtle', badge: 'removed' },
  'MEDIUM': { bg: 'color.background.warning.subtle', badge: 'default' },
  'HARD': { bg: 'color.background.neutral', badge: 'added' },
  'INTERMEDIATE': { bg: 'color.background.success.subtle', badge: 'success' },
  'WET': { bg: 'color.background.information.subtle', badge: 'primary' }
};

const PitStrategyTab = ({ context, pitStrategy }) => {
  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Heading size="medium">Pit Stop Strategy & Tire Management</Heading>
        
        {!pitStrategy || pitStrategy.stints?.length === 0 ? (
          <EmptyState
            header="No Strategy Data"
            description="Pit stop and stint information unavailable."
          />
        ) : (
          <>
            {/* Tire Stints with Color Coding */}
            <Box 
              padding="space.250" 
              backgroundColor="color.background.neutral.bold"
              xcss={{
                borderRadius: '4px',
                borderLeft: '4px solid #37BEFF'
              }}
            >
              <Stack space="space.200">
                <Heading size="small">Tire Stint Strategy</Heading>
                
                <Stack space="space.150">
                  {pitStrategy.stints.map((stint, idx) => {
                    const stintLength = stint.lap_end - stint.lap_start + 1;
                    const isCurrentStint = idx === pitStrategy.stints.length - 1;
                    const compoundStyle = COMPOUND_COLORS[stint.compound] || COMPOUND_COLORS['MEDIUM'];
                    
                    return (
                      <Box 
                        key={idx} 
                        padding="space.200"
                        backgroundColor={isCurrentStint ? "color.background.brand.bold.pressed" : compoundStyle.bg}
                        xcss={{
                          borderRadius: '4px',
                          borderLeft: '4px solid',
                          borderColor: isCurrentStint ? '#00FF00' : '#37BEFF'
                        }}
                      >
                        <Stack space="space.100">
                          <Inline space="space.150" alignBlock="center" spread="space-between">
                            <Inline space="space.100" alignBlock="center">
                              <Heading 
                                size="xsmall"
                                color={isCurrentStint ? "color.text.inverse" : undefined}
                              >
                                STINT {stint.stint_number}
                              </Heading>
                              {isCurrentStint && (
                                <Lozenge appearance="success" isBold>
                                  ACTIVE
                                </Lozenge>
                              )}
                            </Inline>
                            <Badge 
                              text={stint.compound || 'UNKNOWN'} 
                              appearance={compoundStyle.badge}
                            />
                          </Inline>
                          
                          <Inline space="space.400">
                            <Text 
                              size="small"
                              color={isCurrentStint ? "color.text.inverse" : undefined}
                            >
                              Laps <Text weight="bold">{stint.lap_start}</Text> → <Text weight="bold">{stint.lap_end}</Text>
                            </Text>
                            <Text 
                              size="small"
                              color={isCurrentStint ? "color.text.inverse.subtle" : "color.text.subtle"}
                            >
                              ({stintLength} laps)
                            </Text>
                            {stint.tyre_age_at_start > 0 && (
                              <Text size="small" color="color.text.subtlest">
                                Age: {stint.tyre_age_at_start} laps
                              </Text>
                            )}
                          </Inline>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Stack>
            </Box>
            
            {/* Pit Stops Performance Analysis */}
            {pitStrategy.allPitStops?.length > 0 && (
              <Box 
                padding="space.250" 
                backgroundColor="color.background.neutral"
                xcss={{borderRadius: '4px'}}
              >
                <Stack space="space.200">
                  <Inline space="space.100" alignBlock="center" spread="space-between">
                    <Heading size="small">Pit Stop Performance</Heading>
                    <Badge text={`${pitStrategy.allPitStops.length} Stops`} appearance="primary" />
                  </Inline>
                  
                  <Stack space="space.100">
                    {pitStrategy.allPitStops.map((pit, idx) => {
                      const classification = classifyPitStop(pit.pit_duration);
                      const isTeammate = pit.driver_number !== context.driverNumber;
                      
                      return (
                        <Box 
                          key={idx} 
                          padding="space.150" 
                          backgroundColor={
                            classification === 'fast' ? "color.background.success.subtle" :
                            classification === 'slow' ? "color.background.danger.subtle" :
                            "color.background.input"
                          }
                          xcss={{
                            borderRadius: '3px',
                            borderLeft: '3px solid',
                            borderColor: isTeammate ? '#FFD700' : '#37BEFF'
                          }}
                        >
                          <Inline space="space.200" spread="space-between" alignBlock="center">
                            <Badge 
                              text={`#${pit.driver_number}`}
                              appearance={isTeammate ? "default" : "primary"}
                            />
                            <Text size="small">Lap <Text weight="bold">{pit.lap_number}</Text></Text>
                            <Text weight="bold" size="medium">
                              {pit.pit_duration?.toFixed(2)}s
                            </Text>
                            <Lozenge 
                              appearance={
                                classification === 'fast' ? "success" :
                                classification === 'slow' ? "moved" :
                                "default"
                              }
                              isBold={classification === 'fast'}
                            >
                              {classification.toUpperCase()}
                            </Lozenge>
                          </Inline>
                        </Box>
                      );
                    })}
                  </Stack>
                </Stack>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default PitStrategyTab;
