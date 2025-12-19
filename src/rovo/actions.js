import api, { route } from '@forge/api';

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
  
  let priority = 'Low';
  const reasons = [];
  
  // Telemetry-based priority
  if (telemetry.brake === 100 && telemetry.speed > 250) {
    priority = 'Critical';
    reasons.push('Emergency braking at high speed (>250 km/h)');
  } else if (telemetry.throttle === 0 && telemetry.speed < 50 && telemetry.rpm > 0) {
    priority = 'High';
    reasons.push('Possible power unit issue - no throttle response');
  } else if (telemetry.speed < 100 && telemetry.throttle < 30) {
    priority = 'Medium';
    reasons.push('Low speed with reduced throttle - potential issue');
  }
  
  // Radio message keyword analysis
  const urgentKeywords = ['box', 'problem', 'damage', 'retire', 'issue', 'critical', 'broken'];
  if (radioMessage && urgentKeywords.some(kw => radioMessage.toLowerCase().includes(kw))) {
    if (priority === 'Low') priority = 'High';
    reasons.push('Urgent keywords detected in radio message');
  }
  
  return {
    priority,
    reasoning: reasons.join('; ') || 'No critical issues detected',
    confidence: reasons.length > 0 ? 0.85 : 0.50
  };
}

async function searchConfluenceDocs(payload) {
  const { query, spaceKey = 'FW47' } = payload;
  
  try {
    const response = await api.asApp().requestConfluence(
      route`/wiki/rest/api/content/search?cql=space=${spaceKey} AND text~"${query}"&limit=5`,
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
