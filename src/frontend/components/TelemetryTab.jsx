import React from 'react';
import { Box, Stack, Inline, Heading, Text, Lozenge, EmptyState, Image, SectionMessage } from '@forge/react';

const TelemetryTab = ({ context, telemetry }) => {
  
  // 1. CHART GENERATION
  const generateChartUrl = (data) => {
    if (!data || data.length === 0) return null;

    // Downsample for performance (Max 50 points)
    const step = Math.ceil(data.length / 50); 
    const sampledData = data.filter((_, i) => i % step === 0);
    
    // Safety check for data points
    const speeds = sampledData.map(d => d.speed || 0);
    const throttles = sampledData.map(d => d.throttle || 0);

    const chartConfig = {
      type: 'line',
      data: {
        labels: sampledData.map((d, i) => i),
        datasets: [
          {
            label: 'Speed',
            borderColor: 'rgb(0, 160, 226)', // Williams Blue
            backgroundColor: 'rgba(0, 160, 226, 0.1)',
            borderWidth: 2,
            data: speeds,
            yAxisID: 'y-speed',
            pointRadius: 0
          },
          {
            label: 'Throttle',
            borderColor: 'rgb(255, 50, 50)', // Racing Red
            borderWidth: 1,
            data: throttles,
            yAxisID: 'y-throttle',
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        legend: { position: 'bottom' },
        scales: {
          yAxes: [
            { id: 'y-speed', type: 'linear', position: 'left', ticks: { min: 0, max: 360 } },
            { id: 'y-throttle', type: 'linear', position: 'right', ticks: { min: 0, max: 100 }, gridLines: { display: false } }
          ]
        }
      }
    };
    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=1000&h=400&bkg=white`;
  };

  const chartUrl = generateChartUrl(telemetry);

  // 2. STATS CALCULATION (With safety checks)
  const maxSpeed = telemetry ? Math.max(...telemetry.map(t => t.speed || 0)) : 0;
  const avgThrottle = telemetry && telemetry.length > 0
    ? Math.round(telemetry.reduce((a, b) => a + (b.throttle || 0), 0) / telemetry.length) 
    : 0;

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        
        {/* Header */}
        <Inline spread="space-between" alignBlock="center">
          <Heading size="medium">Telemetry Trace</Heading>
          {context.lapNumber ? (
             <Lozenge appearance="inprogress">LAP {context.lapNumber}</Lozenge>
          ) : (
             <SectionMessage appearance="warning"><Text>Add a lap-XX label to view data</Text></SectionMessage>
          )}
        </Inline>
        
        {!telemetry || telemetry.length === 0 ? (
          <EmptyState header="No Telemetry Data" description="Please check the lap label or try a different lap." />
        ) : (
          <Stack space="space.300">
            
            {/* 1. THE MAIN CHART */}
            <Box 
               padding="space.0" 
               backgroundColor="color.background.neutral"
               xcss={{ borderRadius: '4px', overflow: 'hidden' }}
            >
               {chartUrl && <Image src={chartUrl} alt="Telemetry Graph" size="large" />}
            </Box>

            {/* 2. STATS GRID */}
            <Box padding="space.200" backgroundColor="color.background.neutral.subtle">
               <Inline space="space.400" spread="space-between" shouldWrap>
                  <Stack space="space.050">
                    <Text size="small" color="color.text.subtlest">MAX SPEED</Text>
                    <Heading size="small">{maxSpeed} km/h</Heading>
                  </Stack>
                  <Stack space="space.050">
                     <Text size="small" color="color.text.subtlest">AVG THROTTLE</Text>
                     <Heading size="small">{avgThrottle}%</Heading>
                  </Stack>
                  <Stack space="space.050">
                     <Text size="small" color="color.text.subtlest">DATA POINTS</Text>
                     <Heading size="small">{telemetry.length}</Heading>
                  </Stack>
               </Inline>
            </Box>

          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default TelemetryTab;