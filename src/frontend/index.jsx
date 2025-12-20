import React, { useEffect, useState } from 'react';
import ForgeReconciler, { 
  Tabs, TabList, Tab, TabPanel, 
  Box, Stack, Spinner, Text,
  SectionMessage, EmptyState
} from '@forge/react';
import { invoke } from '@forge/bridge';

import Header from './components/Header';
import OverviewTab from './components/OverviewTab';
import TelemetryTab from './components/TelemetryTab';
import PitStrategyTab from './components/PitStrategyTab';
import LapTimesTab from './components/LapTimesTab';

const App = () => {
  const [context, setContext] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [pitStrategy, setPitStrategy] = useState(null);
  const [lapTimes, setLapTimes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const ctx = await invoke('get-ticket-context');
        setContext(ctx);
        
        if (ctx.noData) {
          setLoading(false);
          return;
        }
        
        const payload = {
          sessionKey: ctx.sessionKey,
          driverNumber: ctx.driverNumber,
          lapNumber: ctx.lapNumber
        };
        
        const [telemetryData, pitData, lapData] = await Promise.all([
          invoke('get-telemetry-data', payload),
          invoke('get-pit-strategy', payload),
          invoke('get-lap-times', payload)
        ]);
        
        // Normalize telemetry data
        const normalizedTelemetry = Array.isArray(telemetryData) 
          ? telemetryData 
          : null;
        
        setTelemetry(normalizedTelemetry);
        setPitStrategy(pitData);
        setLapTimes(lapData);
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Loading state
  if (loading) {
    return (
      <Box padding="space.400">
        <Stack space="space.200" alignInline="center">
          <Spinner size="large" />
          <Text weight="medium">Loading FW47 Race Operations...</Text>
        </Stack>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box padding="space.300">
        <SectionMessage appearance="error" title="System Error">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }

  // No data state
  if (context?.noData) {
    return (
      <Box padding="space.400">
        <EmptyState
          header="No Race Operations Data"
          description={context.message}
        />
        <Box paddingBlock="space.200">
          <Text size="small">
            Required labels: <Text weight="bold">driver-XX</Text>, <Text weight="bold">session-XXXX</Text>, <Text weight="bold">lap-XX</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  // Main UI
  return (
    <Box>
      <Header context={context} lapTimes={lapTimes} />
      
      <Tabs id="fw47-tabs">
        <TabList>
          <Tab>Overview</Tab>
          <Tab>Telemetry</Tab>
          <Tab>Pit Strategy</Tab>
          <Tab>Lap Times</Tab>
        </TabList>

        <TabPanel>
          <OverviewTab 
            context={context} 
            lapTimes={lapTimes} 
            pitStrategy={pitStrategy} 
          />
        </TabPanel>

        <TabPanel>
          <TelemetryTab 
            context={context} 
            telemetry={telemetry} 
          />
        </TabPanel>

        <TabPanel>
          <PitStrategyTab 
            context={context} 
            pitStrategy={pitStrategy} 
          />
        </TabPanel>

        <TabPanel>
          <LapTimesTab 
            context={context} 
            lapTimes={lapTimes} 
          />
        </TabPanel>
      </Tabs>
    </Box>
  );
};

ForgeReconciler.render(<App />);
