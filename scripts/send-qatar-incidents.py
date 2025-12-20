import requests
import json
from datetime import datetime

# Get webhook URLs after deploy: forge webtrigger
RADIO_WEBHOOK_URL = "https://YOUR-SITE.atlassian.net/gateway/api/XXXXXXX"
PIT_WEBHOOK_URL = "https://YOUR-SITE.atlassian.net/gateway/api/YYYYYYY"

# Qatar GP 2025 - Curated incidents for demo
QATAR_SESSION_KEY = 9636  # Get from OpenF1

def send_radio_incident(driver_num, timestamp, telemetry_snapshot):
    """Send a radio incident to create Jira ticket"""
    
    # Fetch actual radio from OpenF1
    radio_url = f"https://api.openf1.org/v1/team_radio?session_key={QATAR_SESSION_KEY}&driver_number={driver_num}"
    radios = requests.get(radio_url).json()
    
    # Find radio closest to timestamp
    radio = next((r for r in radios if r['date'] >= timestamp), radios[0])
    
    payload = {
        "session_key": QATAR_SESSION_KEY,
        "driver_number": driver_num,
        "date": radio['date'],
        "recording_url": radio['recording_url'],
        "telemetry": telemetry_snapshot
    }
    
    response = requests.post(RADIO_WEBHOOK_URL, json=payload)
    print(f"✅ Radio ticket created: {response.json()}")

def send_pit_stop(driver_num, lap_number):
    """Send a pit stop to create Jira ticket"""
    
    # Fetch actual pit data from OpenF1
    pit_url = f"https://api.openf1.org/v1/pit?session_key={QATAR_SESSION_KEY}&driver_number={driver_num}&lap_number={lap_number}"
    pits = requests.get(pit_url).json()
    
    stint_url = f"https://api.openf1.org/v1/stints?session_key={QATAR_SESSION_KEY}&driver_number={driver_num}"
    stints = requests.get(stint_url).json()
    
    if pits:
        pit = pits[0]
        stint = next((s for s in stints if s['lap_start'] <= lap_number <= s['lap_end']), None)
        
        payload = {
            "session_key": QATAR_SESSION_KEY,
            "driver_number": driver_num,
            "lap_number": pit['lap_number'],
            "pit_duration": pit['pit_duration'],
            "date": pit['date'],
            "stint": stint
        }
        
        response = requests.post(PIT_WEBHOOK_URL, json=payload)
        print(f"✅ Pit stop ticket created: {response.json()}")

# Demo scenario: Qatar GP 2025
if __name__ == "__main__":
    print("🏎️  Sending Qatar GP 2025 incidents to FW47 app...\n")
    
    # Sainz P7 → P3 charge - key moments
    send_radio_incident(55, "2025-11-29T15:10:00", {
        "speed": 312,
        "rpm": 11200,
        "throttle": 98,
        "brake": 0,
        "n_gear": 8,
        "drs": 10
    })
    
    # Sainz pit stop
    send_pit_stop(55, 15)
    
    # Albon radio
    send_radio_incident(23, "2025-11-29T15:25:00", {
        "speed": 285,
        "rpm": 10800,
        "throttle": 85,
        "brake": 0,
        "n_gear": 7,
        "drs": 0
    })
    
    # Albon pit stop
    send_pit_stop(23, 18)
    
    print("\n✅ Demo incidents sent! Check Jira for new tickets.")
