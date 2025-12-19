import api, { route } from '@forge/api';

export async function createJiraTicket({ summary, description, labels, priority, issueTypeName = 'Task' }) {
  const issueData = {
    fields: {
      project: { key: 'FW47' },
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }]
          }
        ]
      },
      issuetype: { name: issueTypeName }, // Use the provided issue type name
      labels: labels || []
    }
  };
  
  // Only add priority if provided
  if (priority) {
    issueData.fields.priority = { name: priority };
  }
  
  try {
    console.log('Sending to Jira:', JSON.stringify(issueData, null, 2));
    
    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueData)
    });
    
    console.log('Jira response status:', response.status);
    
    const responseText = await response.text();
    console.log('Jira raw response:', responseText);
    
    if (!response.ok) {
      console.error('Jira API error:', responseText);
      throw new Error(`Jira API failed: ${response.status} - ${responseText}`);
    }
    
    const result = JSON.parse(responseText);
    console.log('Jira ticket created successfully:', result.key);
    return result;
    
  } catch (error) {
    console.error('Error creating Jira ticket:', error);
    throw error;
  }
}
