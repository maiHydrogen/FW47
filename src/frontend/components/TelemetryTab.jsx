import React from 'react';
import { Box, Stack, Inline, Heading, Text, Lozenge, SectionMessage, EmptyState, Image, ProgressBar } from '@forge/react';

const TelemetryTab = ({ context, telemetry }) => {
  
  // 1. CHART GENERATOR (Downsampled to 50 points for URL limit)
  const generateChartUrl = (data) => {
    if (!data || data.length === 0) return null;

    // Strict Downsampling for Chart ONLY
    const step = Math.ceil(data.length / 50); 
    const sampledData = data.filter((_, i) => i % step === 0);
    
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
            data: sampledData.map(d => d.speed || 0),
            yAxisID: 'y-speed',
            pointRadius: 0
          },
          {
            label: 'Throttle',
            borderColor: 'rgb(255, 50, 50)', // Red
            borderWidth: 1,
            data: sampledData.map(d => d.throttle || 0),
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

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Inline spread="space-between" alignBlock="center">
          <Heading size="medium">
            Telemetry Analysis {context.lapNumber && `- Lap ${context.lapNumber}`}
          </Heading>
          {context.lapNumber && (
            <Lozenge appearance="inprogress" isBold>LAP {context.lapNumber}</Lozenge>
          )}
        </Inline>

        {!context.lapNumber ? (
          <SectionMessage appearance="warning" title="Lap Selection Required">
            <Text>Add a <Text weight="bold">lap-XX</Text> label to this ticket.</Text>
          </SectionMessage>
        ) : !telemetry || telemetry.length === 0 ? (
          <EmptyState header="No Telemetry" description="Data unavailable for this lap." />
        ) : (
          <Stack space="space.300">
            
            {/* 1. THE CHART (Visual) */}
            <Box 
               padding="space.0" 
               backgroundColor="color.background.neutral"
               xcss={{ borderRadius: 'border.radius', overflow: 'hidden' }}
            >
               {chartUrl && <Image src={chartUrl} alt="Telemetry Graph" size="large" />}
            </Box>
            
            <SectionMessage appearance="info">
               <Text>Showing full telemetry dataset ({telemetry.length} points)</Text>
            </SectionMessage>

            {/* 2. THE RAW DATA LIST (Requested Feature) */}
            <Box xcss={{ height: '400px', overflowY: 'auto' }}>
              <Stack space="space.100">
                {/* List Header */}
                <Box padding="space.100" backgroundColor="color.background.neutral.bold">
                  <Inline spread="space-between">
                    <Text size="small" color="color.text.inverse">SPEED</Text>
                    <Text size="small" color="color.text.inverse">RPM</Text>
                    <Text size="small" color="color.text.inverse">THROTTLE</Text>
                    <Text size="small" color="color.text.inverse">BRAKE</Text>
                  </Inline>
                </Box>
                
                {/* List Body - Limiting render to first 100 to prevent crash, user can scroll or we'd need pagination */}
                {telemetry.slice(0, 100).map((point, idx) => (
                  <Box 
                    key={idx} 
                    padding="space.100" 
                    backgroundColor={idx % 2 === 0 ? "color.background.neutral.subtle" : "color.background.neutral"}
                  >
                    <Inline spread="space-between" alignBlock="center">
                      <Box xcss={{width: '60px'}}><Text weight="bold">{point.speed} <Text size="small" color="color.text.subtlest">km/h</Text></Text></Box>
                      <Box xcss={{width: '60px'}}><Text size="small">{point.rpm}</Text></Box>
                      
                      <Box xcss={{width: '80px'}}>
                        <Stack space="space.0">
                          <ProgressBar value={(point.throttle || 0) / 100} appearance="success" />
                          <Text size="small" align="end">{point.throttle}%</Text>
                        </Stack>
                      </Box>
                      
                      <Box xcss={{width: '80px'}}>
                         <Stack space="space.0">
                           <ProgressBar value={(point.brake || 0) / 100} appearance="danger" />
                           <Text size="small" align="end">{point.brake}%</Text>
                         </Stack>
                      </Box>
                    </Inline>
                  </Box>
                ))}
                
                {telemetry.length > 100 && (
                   <Text align="center" color="color.text.subtlest">
                     ... {telemetry.length - 100} more points hidden for performance ...
                   </Text>
                )}
              </Stack>
            </Box>
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default TelemetryTab;