# FW47 - The AI Race Engineer for Jira

> **Codegeist 2025 Submission** | **Theme:** Atlassian Williams Racing

![Banner Image](https://images.unsplash.com/photo-1534079822877-6644f776268f?q=80&w=2836&auto=format&fit=crop) 
*(Tip: Replace this link with a screenshot of your actual Jira Dashboard)*

## 🏁 The Problem
In Formula 1, milliseconds matter. Race Engineers process gigabytes of telemetry data, radio comms, and tire strategy in real-time. 

Traditional software tools can be too slow for the "Pit Wall." When a driver reports a **Brake Failure**, the team can't afford to manually create a Jira ticket, fill in fields, and search Confluence for the repair manual. They need speed.

## 🛠️ The Solution: FW47
**FW47** turns Jira into a high-performance **Race Operations Center**. It bridges the gap between **OpenF1 Live Telemetry** and **Atlassian Rovo**, creating a fully automated, AI-driven race engineering platform.

### ✨ Key Features

#### 1. 🧠 Rovo Race Engineer (AI Agent)
A specialized **Rovo Agent** that acts as your Chief Mechanic.
* **Ask:** *"Analyze the telemetry from the last incident."*
* **Response:** Rovo checks the `telemetryJson`, detects "Emergency Braking (>280kph)," and calculates priority automatically.
* **SOP Retrieval:** Automatically searches **Confluence** for specific repair procedures (e.g., "Brake-by-Wire Reset Protocol") based on the incident type.

#### 2. 📊 Live Telemetry Dashboard
A custom **Jira Issue Panel** built with **Forge UI Kit 2**.
* Visualizes real-time **Speed, Throttle, Brake, and RPM** data directly on the ticket.
* Displays **Lap Time Analysis** (Purple/Green sectors) and **Pit Strategy** (Tire Compounds).
* No need to switch tabs to a separate telemetry tool.

#### 3. ⚡ Automated "Pit Wall" Webhooks
The system "watches" the race for you.
* **Pit Stop Trigger:** Automatically creates a Jira ticket when a car enters the pit lane, logging duration and tire compound.
* **Radio Incident Trigger:** Detects critical keywords (e.g., "No Power", "Box Box") in driver radio and spawns a **High Priority** incident ticket with attached audio and telemetry.

---

## 🏗️ Tech Stack
* **Platform:** Atlassian Forge (Node.js 22.x)
* **UI Framework:** Forge UI Kit 2 (React)
* **AI:** Atlassian Rovo (Agents & Actions)
* **Data Source:** [OpenF1 API](https://openf1.org/) (Live Formula 1 Data)
* **Automation:** Python Webhook Triggers

---

## 🚀 Installation & Setup

### Prerequisites
1.  An Atlassian Cloud Site (Jira + Confluence).
2.  [Atlassian Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/).
3.  Node.js 18+.

### 1. Clone & Install
```bash
git clone [https://github.com/maiHydrogen/FW47.git](https://github.com/maiHydrogen/FW47.git)
cd FW47
npm install