# FW47: Telemetry Anomaly Pipeline for Jira

<img width="2816" height="1536" alt="FW47_logo" src="https://github.com/user-attachments/assets/5196f9f9-95d8-48f8-ab93-3e85c9895309" />

> **Status: being rebuilt.** This README describes only what exists in the repo today. The rebuild (v3) is
> planned step by step in [project_plan.md](project_plan.md), including the full project history.

## Where this came from

FW47 started as an entry for Atlassian's **Codegeist 2025** hackathon (theme: Atlassian Williams Racing). The
idea was an "AI race engineer for Jira": spot problems in F1 car telemetry, file Jira issues for them, pull the
matching procedure from Confluence and use Rovo as the assistant.

We didn't submit it. The problem was more themed than real, public F1 data can't diagnose faults (it only has
six channels at about 4 Hz), and the "live" and "predictive" parts were never actually built. v3 rebuilds it as
an honest, measurable pipeline: a Python service that streams replayed telemetry, scores it against each
car's normal behaviour, and routes deduplicated incidents into Jira and Confluence through a Forge app. See
[project_plan.md](project_plan.md).

## What exists today

All of this is the Forge app in `src/` (Node.js). The Python pipeline described in the plan doesn't exist yet.

| Part | What it does | Where |
|---|---|---|
| Jira issue panel | Tabs showing OpenF1 data for the incident: overview, telemetry, pit strategy, lap times | `src/frontend/` |
| Radio webtrigger | Given a session and driver, fetches their team radio and the telemetry around it, scores it with the rules below and creates a Jira issue | `src/webhooks/radioWebhook.js` |
| Pit stop webtrigger | Creates a Jira issue for a pit stop, skipping duplicates | `src/webhooks/pitWebhook.js` |
| Scheduled pollers | Every 5 minutes (Forge's shortest interval), check OpenF1 for new radio messages and pit stops | `src/listeners/` |
| Rovo agent | Four actions: calculate priority, search Confluence for SOPs, suggest solutions, suggest a pit window | `src/rovo/actions.js` |
| Anomaly rules | Hand-written thresholds on speed, RPM, gear, throttle, brake and DRS, plus a per-driver speed baseline | `src/services/anomalyDetection.js`, `src/services/telemetryBaseline.js` |
| Pit window | A fixed table of typical stint lengths per tyre compound | `src/services/pitStrategy.js` |
| Demo script | Sends a few Qatar 2025 events to the webtriggers | `scripts/send-qatar-incidents.py` |
| Tests | Unit tests for the rules, pit window, calculations and validators | `npm test` |

### Known limitations

- **Not live.** Data comes from OpenF1's historical API, and the pollers run every 5 minutes at best.
- **No machine learning.** The anomaly rules and pit windows are hand-written and haven't been checked against
  real races yet. That evaluation is part of v3.
- **Radio isn't analysed.** OpenF1 provides radio as audio only, so there is no transcript to read. Radio
  messages only mark a moment in time; the telemetry around it is what gets scored.
- **Confluence is read-only.** The app searches Confluence for SOPs but doesn't write to it.
- **Webtriggers aren't authenticated.** Anyone with a webtrigger URL can create issues. v3 adds signed requests.

## Tech stack

- **Platform:** Atlassian Forge (Node.js 22.x)
- **UI:** Forge UI Kit (React)
- **AI:** Atlassian Rovo (agent and actions)
- **Data:** [OpenF1 API](https://openf1.org/) (historical sessions)

## Setup

### Prerequisites

1. An Atlassian Cloud site with Jira and Confluence. A free developer site works.
2. The [Atlassian Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/).
3. Node.js 22.
4. Python 3 with `requests`, only for the demo script.

### Install and deploy

```bash
git clone https://github.com/maiHydrogen/FW47.git
cd FW47
npm install
forge register
forge deploy
forge install
```

### Webtriggers

Get the URLs of the two webtriggers (`radio-incident-webhook` and `pit-stop-webhook`):

```bash
forge webtrigger
```

Treat these URLs as secrets: anyone who has one can create Jira issues on your site. Don't commit them.

To send the demo events, put the URLs into `RADIO_WEBHOOK_URL` and `PIT_WEBHOOK_URL` in
`scripts/send-qatar-incidents.py`, then run:

```bash
python3 scripts/send-qatar-incidents.py
```

### Tests

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).
