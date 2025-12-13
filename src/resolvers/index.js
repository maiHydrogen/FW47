import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// 1. The Resolver (Allows frontend to talk to backend)
resolver.define('getTelemetry', async (req) => {
  // FIX: The property is named 'key', not 'issueKey'
  const { key } = req.context.extension.issue;

  console.log(`Fetching data for issue: ${key}`); // Debug log

  try {
    // A. Fetch the Issue Description from Jira
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=description`, {
      headers: { "Accept": "application/json" }
    });
    
    // Check if request failed
    if (response.status !== 200) {
        console.error(`Jira API Error: ${response.status}`);
        return null;
    }

    const data = await response.json();
    
    // Safety check: Does 'fields' exist?
    if (!data.fields || !data.fields.description) {
        console.log("No description field found.");
        return null;
    }

    const description = data.fields.description;

    // B. Find the Hidden Code Block (Where we stored the JSON)
    if (!description || !description.content) return null;

    const codeBlock = description.content.find(node => node.type === 'codeBlock');
    
    if (codeBlock && codeBlock.content && codeBlock.content[0]) {
      // C. Parse the text inside the code block into a JSON Object
      const rawJson = codeBlock.content[0].text;
      return JSON.parse(rawJson);
    }

    return null; // No telemetry found

  } catch (err) {
    console.error("Telemetry Fetch Error:", err);
    return null;
  }
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

  const { driver, message, lap, telemetry, eventType } = body;
  console.log(`Received Radio from ${driver}: ${message}`);

  const projectKey = "FW47";

  let issueTypeName = "Race Incident"; // Default


  if (eventType === "pit_stop") {
    issueTypeName = "Strategy Calls";
  }

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
                  { type: "text", text: `Lap ${lap} - $${(eventType || 'radio').toUpperCase()}` }
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
      console.log(`SUCCESS! ${eventType} Ticket: ${data.key}`);
      return {
        body: JSON.stringify({ success: true, ticket: data.key }),
        statusCode: 200
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
