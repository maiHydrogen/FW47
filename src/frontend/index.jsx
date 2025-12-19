import React, { useEffect, useState } from 'react';
import ForgeReconciler, { 
  Text, Strong, Box, Heading, Button, Stack, Inline, Em,
  LineChart, BarChart, PieChart, DonutChart,
  SectionMessage, StatusLozenge, Badge, Tabs, TabList, Tab, TabPanel
} from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [tickets, setTickets] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(23); // Default to Albon
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadTickets();
    }
  }, [selectedSession, selectedDriver]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const result = await invoke('get-2025-sessions');
      setSessions(result.sessions || []);
      if (result.sessions && result.sessions.length > 0) {
        setSelectedSession(result.sessions[0].session_key);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTickets = async () => {
    try {
      setLoading(true);
      const result = await invoke('get-session-tickets', {
        sessionKey: selectedSession,
        driverNumber: selectedDriver
      });
      setTickets(result.tickets || []);
    } catch (error) {
      console.error('Error loading tickets:', error);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  const getDriverName = (number) => {
    if (number === 23) return 'Alex Albon';
    if (number === 55) return 'Carlos Sainz';
    return `Driver #${number}`;
  };

  // Prepare chart data
  const getIncidentTypeData = () => {
    const incidentCounts = {};
    tickets.forEach(t => {
      const type = t.incident_type || 'General';
      incidentCounts[type] = (incidentCounts[type] || 0) + 1;
    });
    
    return Object.entries(incidentCounts).map(([type, count]) => ({
      type,
      count,
      label: type
    }));
  };

  const getPriorityData = () => {
    const priorityCounts = { High: 0, Medium: 0, Low: 0 };
    tickets.forEach(t => {
      const priority = t.priority || 'Medium';
      if (priorityCounts[priority] !== undefined) {
        priorityCounts[priority]++;
      }
    });
    
    return Object.entries(priorityCounts).map(([priority, count]) => ({
      priority,
      count,
      label: priority
    }));
  };

  const getLapDistributionData = () => {
    const lapCounts = {};
    tickets.forEach(t => {
      if (t.lap_number) {
        const lapRange = Math.floor(t.lap_number / 10) * 10;
        const key = `Laps ${lapRange}-${lapRange + 9}`;
        lapCounts[key] = (lapCounts[key] || 0) + 1;
      }
    });
    
    return Object.entries(lapCounts).map(([range, count]) => ({
      range,
      count
    }));
  };

  // Get latest telemetry from tickets
  const getLatestTelemetry = () => {
    if (tickets.length === 0) return null;
    // This would come from ticket description parsing or custom fields
    return {
      speed: 305,
      rpm: 11500,
      throttle: 95,
      brake: 0,
      gear: 8,
      drs: 12
    };
  };

  const selectedSessionData = sessions.find(s => s.session_key === selectedSession);

  return (
    <Box padding="space.200">
      <Heading size="large">🏎️ FW47 Race Engineering</Heading>
      
      {/* Session & Driver Selector */}
      <Stack space="space.200">
        <Box>
          <Text><Strong>Session:</Strong></Text>
          {selectedSessionData && (
            <Text>{selectedSessionData.meeting_name} ({new Date(selectedSessionData.date_start).toLocaleDateString()})</Text>
          )}
        </Box>

        <Inline space="space.100">
          <Button 
            text="Alex Albon (#23)" 
            appearance={selectedDriver === 23 ? 'primary' : 'default'}
            onClick={() => setSelectedDriver(23)}
          />
          <Button 
            text="Carlos Sainz (#55)" 
            appearance={selectedDriver === 55 ? 'primary' : 'default'}
            onClick={() => setSelectedDriver(55)}
          />
        </Inline>
      </Stack>

      {loading ? (
        <Box paddingBlock="space.300">
          <Text>Loading data...</Text>
        </Box>
      ) : (
        <Tabs onChange={setActiveTab} id="dashboard-tabs">
          <TabList>
            <Tab>Overview</Tab>
            <Tab>Incidents</Tab>
            <Tab>Telemetry</Tab>
          </TabList>

          {/* Overview Tab */}
          <TabPanel>
            <Stack space="space.300">
              <Box>
                <Heading size="medium">Session Summary</Heading>
                <SectionMessage appearance="information">
                  <Text>
                    <Strong>{tickets.length}</Strong> total incidents recorded for {getDriverName(selectedDriver)}
                  </Text>
                </SectionMessage>
              </Box>

              {/* Incident Type Distribution */}
              {getIncidentTypeData().length > 0 && (
                <Box>
                  <Heading size="small">Incident Type Distribution</Heading>
                  <PieChart 
                    data={getIncidentTypeData()}
                    valueAccessor="count"
                    labelAccessor="label"
                    colorAccessor="type"
                    height={300}
                  />
                </Box>
              )}

              {/* Priority Breakdown */}
              {getPriorityData().length > 0 && (
                <Box>
                  <Heading size="small">Priority Breakdown</Heading>
                  <DonutChart 
                    data={getPriorityData()}
                    valueAccessor="count"
                    labelAccessor="label"
                    colorAccessor="priority"
                    height={250}
                  />
                </Box>
              )}

              {/* Lap Distribution */}
              {getLapDistributionData().length > 0 && (
                <Box>
                  <Heading size="small">Incident Distribution by Lap</Heading>
                  <BarChart 
                    data={getLapDistributionData()}
                    xAccessor="range"
                    yAccessor="count"
                    height={250}
                  />
                </Box>
              )}
            </Stack>
          </TabPanel>

          {/* Incidents Tab */}
          <TabPanel>
            <Box paddingBlock="space.200">
              <Heading size="medium">Incident Timeline</Heading>
              {tickets.length === 0 ? (
                <Text><Em>No incidents recorded</Em></Text>
              ) : (
                <Stack space="space.150">
                  {tickets.map(ticket => (
                    <Box key={ticket.key} padding="space.100" backgroundColor="color.background.neutral">
                      <Inline space="space.100" alignBlock="center">
                        <StatusLozenge 
                          text={ticket.incident_type} 
                          appearance={ticket.priority === 'High' ? 'removed' : ticket.priority === 'Medium' ? 'inprogress' : 'success'}
                        />
                        <Text><Strong>{ticket.key}</Strong></Text>
                        {ticket.lap_number && <Badge text={`Lap ${ticket.lap_number}`} />}
                      </Inline>
                      <Text>{ticket.summary}</Text>
                      <Text><Em>Priority: {ticket.priority} | Status: {ticket.status}</Em></Text>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          </TabPanel>

          {/* Telemetry Tab */}
          <TabPanel>
            <Box paddingBlock="space.200">
              <Heading size="medium">Latest Telemetry Snapshot</Heading>
              <SectionMessage appearance="discovery">
                <Text>Telemetry data extraction from incidents - Coming soon</Text>
              </SectionMessage>
            </Box>
          </TabPanel>
        </Tabs>
      )}
    </Box>
  );
};

ForgeReconciler.render(<App />);
