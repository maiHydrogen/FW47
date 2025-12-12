import requests
import json
import time

# 1. SETUP: Paste your Forge Webtrigger URL here
WEBTRIGGER_URL = "https://aa8d3260-46fe-414b-93e8-439fb94c4203.hello.atlassian-dev.net/x1/WyqE2mnfqwMPT7UWJlFs6lFFch4"

# 2. SIMULATE A LAP
print("Starting Simulation: FW47 (Albon) - Lap 14")
time.sleep(1)

# Mock Data: Driver reporting a vibration
payload = {
    "driver": "Carlos Sainz",
    "lap": 21,
    "message": "Front left feeling a bit off, possibly a damage to wing or suspension.",
    "telemetry": {
        "speed": 290,
        "tire_temp": 105,
        "gear": 7
    }
}

print(f"Radio Check: Sending message from {payload['driver']}...")

try:
    # 3. SEND TO JIRA
    response = requests.post(WEBTRIGGER_URL, json=payload)
    
    if response.status_code == 200:
        print("\n SUCCESS! Jira Ticket Created.")
        print("Ticket Key:", response.json().get('ticket'))
    else:
        print("\n FAILED.")
        print("Status:", response.status_code)
        print("Error:", response.text)

except Exception as e:
    print(f"\n CONNECTION ERROR: {e}")
