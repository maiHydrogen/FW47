import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Strong, SectionMessage, Stack } from '@forge/react';

const App = () => {
  return (
    <Stack>
      <SectionMessage title="Race Control Connected" appearance="info">
        <Text>Waiting for Telemetry...</Text>
      </SectionMessage>
      <Text><Strong>System Status:</Strong> Online</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);