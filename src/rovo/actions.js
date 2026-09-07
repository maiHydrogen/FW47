import api, { route } from '@forge/api';
import { detectAnomalies } from '../services/anomalyDetection.js';

export const handler = async (req) => {
  const { actionKey, payload } = req;

  switch (actionKey) {
    case 'calculate-priority':
      return await calculatePriority(payload);

    case 'search-confluence-sops':
      return await searchConfluenceDocs(payload);

    case 'suggest-solutions':
      return await suggestSolutions(payload);

    default:
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown actionKey: ${actionKey}` })
      };
  }
};

async function calculatePriority(payload) {
  const { telemetryJson, radioMessage } = payload;

  let telemetry = {};
  try {
    telemetry = JSON.parse(telemetryJson || '{}');
  } catch (e) {
    console.error('Invalid telemetry JSON');
  }

  const { priority, reasoning, confidence, incidentType } = detectAnomalies(telemetry, radioMessage);

  return { priority, reasoning, confidence, incidentType };
}

// Escape a value for safe use inside a double-quoted CQL string literal.
// Without this, a query containing a `"` can close the literal early and
// inject arbitrary CQL clauses (e.g. `text~"x" OR space="OTHER"`).
function escapeCql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function searchConfluenceDocs(payload) {
  const { query, spaceKey = 'FW47' } = payload;

  if (!query || typeof query !== 'string') {
    return { documents: [], error: 'A search query is required' };
  }

  // Space keys are short identifiers (letters/digits/underscore/hyphen) -
  // reject anything else instead of trying to escape it, since it's also
  // used unquoted in raw CQL.
  const safeSpaceKey = /^[A-Za-z0-9_-]+$/.test(spaceKey) ? spaceKey : 'FW47';
  const safeQuery = escapeCql(query).slice(0, 200);

  try {
    const cql = `space="${safeSpaceKey}" AND text~"${safeQuery}"`;
    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/search?cql=${cql}&limit=5`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    const results = await response.json();
    
    return {
      documents: results.results.map(doc => ({
        title: doc.title,
        url: doc._links.webui,
        excerpt: doc.excerpt || 'No excerpt available'
      }))
    };
  } catch (error) {
    console.error('Error searching Confluence:', error);
    return { documents: [], error: error.message };
  }
}

async function suggestSolutions(payload) {
  const { incidentType, telemetryJson } = payload;
  
  const solutionDatabase = {
    'emergency-braking': [
      '1. Check brake disc temperatures post-incident',
      '2. Review brake-by-wire system logs for anomalies',
      '3. Inspect brake pad wear levels',
      '4. Analyze brake pressure data from telemetry'
    ],
    'power-unit': [
      '1. Review ERS deployment strategy and battery SOC',
      '2. Check MGU-K and MGU-H telemetry for failures',
      '3. Analyze fuel flow and mixture settings',
      '4. Inspect turbocharger RPM logs'
    ],
    'pit-slow': [
      '1. Review pit crew video footage for procedural issues',
      '2. Check wheel gun torque settings and air pressure',
      '3. Analyze pit lane entry/exit speed delta',
      '4. Review tyre preparation timing'
    ],
    'engine-stall': [
      '1. Check for a stall/kill-switch fault or fuel starvation',
      '2. Review ignition and fuel pump telemetry at the cutout moment',
      '3. Instruct driver on restart procedure if car is stationary',
      '4. Prepare recovery vehicle dispatch if car cannot be restarted'
    ],
    'gearbox-failure': [
      '1. Check gearbox hydraulic pressure and paddle-shift actuator logs',
      '2. Review gear selection telemetry for repeated neutral drops',
      '3. Advise driver to hold current gear manually if possible',
      '4. Prepare for potential retirement if fault is unrecoverable'
    ],
    'drs-failure': [
      '1. Instruct driver to manually close DRS immediately - safety priority',
      '2. Check DRS actuator and pod telemetry for a stuck-open fault',
      '3. Notify race control if the fault persists (mandatory disclosure)',
      '4. Review flap for physical/mechanical damage at next pit stop'
    ],
    'potential-issue': [
      '1. Monitor driver feedback on next radio message',
      '2. Compare telemetry to previous laps for anomalies',
      '3. Check for progressive degradation patterns',
      '4. Prepare contingency strategy if issue escalates'
    ]
  };
  
  const suggestions = solutionDatabase[incidentType] || [
    'No specific solutions available for this incident type.',
    'Escalate to senior race engineers for manual analysis.',
    'Review historical data for similar incidents.'
  ];
  
  return {
    recommendations: suggestions,
    incidentType
  };
}
