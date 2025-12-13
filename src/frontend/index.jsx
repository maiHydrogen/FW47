import React, { useEffect, useState } from 'react';
import ForgeReconciler, { 
  Text, 
  Strong, 
  SectionMessage, 
  Stack, 
  Inline, 
  Heading, 
  Tag,
  Spinner,
  Link,
  Icon
} from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke('getTelemetry').then((data) => {
      setTelemetry(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner size="large" />;

  if (!telemetry) {
    return (
      <SectionMessage title="No Signal" appearance="warning">
        <Text>No telemetry data found.</Text>
      </SectionMessage>
    );
  }

  const isPitStop = telemetry.pit_duration !== undefined;

  // --- SMART DOCS LOGIC ---
  const getRelevantDocs = () => {
    const docs = [];
    
    // Always include General Spec
    docs.push({ title: "FW47 Technical Regulations 2025", url: "#" });

    if (isPitStop) {
      docs.push({ title: "Pit Stop Error Protocols", url: "#" });
      docs.push({ title: "Wheel Gun Torque Specs", url: "#" });
    } else {
      // Radio / Incident Logic
      if (telemetry.tire_temp > 100) {
        docs.push({ title: "SOP: Active Cooling Configurations", url: "#" });
      }
      if (telemetry.brake > 80) {
         docs.push({ title: "Brake Duct Tape Levels", url: "#" });
      }
      if (telemetry.speed < 200 && telemetry.throttle > 90) {
         docs.push({ title: "PU Recovery Modes (Fail 8)", url: "#" });
      }
      if (telemetry.rpm > 11000) {
        docs.push({ title: "Gearbox Sync Diagnostics", url: "#" });
      }
    }
    return docs;
  };

  const relevantDocs = getRelevantDocs();

  return (
    <Stack space="space.200">
      {/* HEADER */}
      <Inline space="space.100" alignBlock="center">
        <Heading as="h2">FW47 Telemetry</Heading>
        {isPitStop ? <Tag text="PIT STOP" color="blue" /> : <Tag text="INCIDENT" color="red" />}
      </Inline>

      {/* DASHBOARD GRID */}
      {isPitStop ? (
         <Stack space="space.200">
           <SectionMessage 
             appearance={telemetry.pit_duration < telemetry.field_avg_pit_time ? "success" : "warning"}
             title={telemetry.pit_duration < telemetry.field_avg_pit_time ? "⚡ FAST STOP" : "🐢 SLOW STOP"}
           >
             <Heading as="h1">{telemetry.pit_duration}s</Heading>
             <Text>vs Field Avg: {telemetry.field_avg_pit_time}s</Text>
           </SectionMessage>

           <Stack space="space.050">
              <Text><Strong>Delta:</Strong></Text>
              {telemetry.pit_duration < telemetry.field_avg_pit_time ? (
                 <Tag text={`🟢 -${(telemetry.field_avg_pit_time - telemetry.pit_duration).toFixed(2)}s FASTER`} color="green" />
              ) : (
                 <Tag text={`🔴 +${(telemetry.pit_duration - telemetry.field_avg_pit_time).toFixed(2)}s SLOWER`} color="red" />
              )}
           </Stack>
           <DataRow label="Compound" value={telemetry.tire_compound} />
         </Stack>
      ) : (
         <Stack space="space.100">
           <DataRow label="Speed" value={`${telemetry.speed} km/h`} />
           <DataRow label="Tire Temp" value={`${telemetry.tire_temp}°C`} />
           <DataRow label="Gear" value={`Run ${telemetry.gear}`} />
           {telemetry.throttle && <DataRow label="Throttle" value={`${telemetry.throttle}%`} />}
         </Stack>
      )}

      {/* RELEVANT DOCS SECTION (NEW) */}
      <Stack space="space.100">
        <Heading as="h3">Recommended SOPs</Heading>
        {relevantDocs.map((doc, index) => (
          <Inline key={index} space="space.100">
            <Text>📄</Text>
            <Link href={doc.url} openNewTab>{doc.title}</Link>
          </Inline>
        ))}
      </Stack>
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