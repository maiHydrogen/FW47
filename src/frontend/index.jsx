import React, { useEffect, useState } from 'react';
import ForgeReconciler, { 
  Text, 
  Strong, 
  SectionMessage, 
  Stack, 
  Inline, 
  Heading, 
  Tag,
  Spinner
} from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke('getTelemetry').then((data) => {
      // DEBUG: Log what the frontend actually got
      console.log("Dashboard received:", data); 
      setTelemetry(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner size="large" />;

  // If no data, show a clear message
  if (!telemetry) {
    return (
      <SectionMessage title="No Telemetry Signal" appearance="warning">
        <Text>This report does not contain valid flight data.</Text>
      </SectionMessage>
    );
  }

  const isPitStop = telemetry.pit_duration !== undefined;

  return (
    <Stack space="space.200">
      {/* HEADER */}
      <Inline space="space.100" alignBlock="center">
        <Heading as="h2">FW47 Telemetry</Heading>
        {isPitStop ? (
          <Tag text="PIT STOP" color="blue" />
        ) : (
          <Tag text="RADIO INCIDENT" color="red" />
        )}
      </Inline>

      {/* DASHBOARD GRID */}
      {isPitStop ? (
         <Stack space="space.100">
           <DataRow label="Duration" value={`${telemetry.pit_duration}s`} />
           <DataRow label="Stationary" value={`${telemetry.stationary_time}s`} />
           <DataRow label="Compound" value={telemetry.tire_compound} />
         </Stack>
      ) : (
         <Stack space="space.100">
           <DataRow label="Speed" value={`${telemetry.speed} km/h`} />
           <DataRow label="Tire Temp" value={`${telemetry.tire_temp}°C`} />
           <DataRow label="Gear" value={`Run ${telemetry.gear}`} />
           {telemetry.throttle && (
             <DataRow label="Throttle" value={`${telemetry.throttle}%`} />
           )}
         </Stack>
      )}
    </Stack>
  );
};

const DataRow = ({ label, value }) => (
  <Inline space="space.between" alignBlock="center">
    <Text><Strong>{label}</Strong></Text>
    <Text>{value}</Text>
  </Inline>
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);