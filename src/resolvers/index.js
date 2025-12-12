import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// UI Function
resolver.define('getText', (req) => {
  return 'Hello from Race Control';
});

export const handler = resolver.getDefinitions();

// --- REAL MODE: CREATE TICKET ---
export const runRadioListener = async (req) => {
  let body;
  try {
    body = JSON.parse(req.body);
  } catch (e) {
    return { body: "Error: Invalid JSON", statusCode: 400 };
  }

  const { driver, message, lap, telemetry } = body;
  console.log(`Received Radio from ${driver}: ${message}`);

  const projectKey = "FW47"; 

  const issueTypeName = "Race Incident";

  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: `${driver}: ${message}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: `Lap ${lap} Incident Report` }
                ]
              },
              {
                type: "codeBlock",
                attrs: { language: "json" },
                content: [
                  { type: "text", text: JSON.stringify(telemetry, null, 2) }
                ]
              }
            ]
          },
          issuetype: { name: issueTypeName } 
        }
      })
    });

    if (response.status === 201) {
      const data = await response.json();
      console.log(`SUCCESS! Ticket Created: ${data.key}`);
      return { 
        body: JSON.stringify({ success: true, ticket: data.key }),
      };
    } else {
      const errorText = await response.text();
      console.error(`JIRA REJECTED: ${errorText}`);
      return { body: errorText, statusCode: 500 };
    }
  } catch (err) {
    console.error(err);
    return { body: err.toString(), statusCode: 500 };
  }
};