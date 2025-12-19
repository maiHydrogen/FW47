import Resolver from '@forge/resolver';
import { fetch2025Sessions, fetchDriverInfo } from './openf1.js';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// Get all 2025 race sessions
resolver.define('get-2025-sessions', async (req) => {
  try {
    const sessions = await fetch2025Sessions();
    console.log(`Fetched ${sessions.length} sessions from 2025`);
    return { sessions };
  } catch (error) {
    console.error('Error in get-2025-sessions:', error);
    return { sessions: [], error: error.message };
  }
});

// Get tickets for a session filtered by driver
resolver.define('get-session-tickets', async (req) => {
  try {
    const { sessionKey, driverNumber } = req.payload;
    
    // Build JQL query
    let jql = 'project = FW47 ORDER BY created DESC';
    
    if (driverNumber) {
      jql = `project = FW47 AND labels = "driver-${driverNumber}" ORDER BY created DESC`;
    }
    
    console.log('Searching Jira with JQL:', jql);
    
    // Use the new /search/jql endpoint
    const response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jql: jql,
        maxResults: 50,
        fields: ['summary', 'status', 'priority', 'labels', 'issuetype', 'created']
      })
    });
    
    console.log('Jira search response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Jira search error:', errorText);
      throw new Error(`Jira search failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.values?.length || 0} tickets`);
    
    // Parse tickets - NOTE: new endpoint uses 'values' instead of 'issues'
    const tickets = (data.values || []).map(issue => {
      const labels = issue.labels || [];
      const driverLabel = labels.find(l => l.startsWith('driver-'));
      const lapLabel = labels.find(l => l.startsWith('lap-'));
      const incidentType = labels.find(l => !l.startsWith('driver-') && !l.startsWith('lap-') && !l.startsWith('pit-') && !l.startsWith('radio-'));
      
      return {
        key: issue.key,
        summary: issue.summary,
        status: issue.status?.name || 'Unknown',
        priority: issue.priority?.name || 'Medium',
        issuetype: issue.issuetype?.name || 'Task',
        driver_number: driverLabel ? parseInt(driverLabel.replace('driver-', '')) : null,
        lap_number: lapLabel ? parseInt(lapLabel.replace('lap-', '')) : null,
        incident_type: incidentType?.replace(/-/g, ' ').toUpperCase() || 'General',
        created: issue.created
      };
    });
    
    return { tickets };
    
  } catch (error) {
    console.error('Error in get-session-tickets:', error);
    return { tickets: [], error: error.message };
  }
});

export const handler = resolver.getDefinitions();
