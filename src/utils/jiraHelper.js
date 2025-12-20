import api, { route } from '@forge/api';

export async function createJiraTicket({ summary, description, labels = [], priority = 'Medium' }) {
  try {
    const projectKey = 'FW47';
    
    const issueData = {
      fields: {
        project: { key: projectKey },
        summary: summary,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: description
                }
              ]
            }
          ]
        },
        issuetype: { name: 'Task' },
        labels: labels,
        priority: { name: priority }
      }
    };
    
    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(issueData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Jira API error (${response.status}):`, errorText);
      
      // 🔥 NEW: Better error messages
      if (response.status === 404 || errorText.includes('project')) {
        throw new Error(`Project "${projectKey}" not found. Please create a Jira project named "FW47" first.`);
      }
      
      if (response.status === 401) {
        throw new Error('Authentication failed. Check app permissions in manifest.yml');
      }
      
      throw new Error(`Failed to create ticket: ${response.status} - ${errorText}`);
    }
    
    const ticket = await response.json();
    console.log('✅ Created ticket:', ticket.key);
    return ticket;
    
  } catch (error) {
    console.error('❌ Error creating Jira ticket:', error);
    throw error;
  }
}
