import fastf1
import requests
import json
import os
import random

# --- CONFIGURATION ---
WEBTRIGGER_URL = "https://aa8d3260-46fe-414b-93e8-439fb94c4203.hello.atlassian-dev.net/x1/WyqE2mnfqwMPT7UWJlFs6lFFch4"  
CACHE_DIR = "f1_cache"

# 1. SETUP FASTF1
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

fastf1.Cache.enable_cache(CACHE_DIR)

print("Loading Session: Monaco 2025 (Race)...")
session = fastf1.get_session(2025, 'Monaco', 'R')
session.load()

# 2. GET DRIVER DATA (Alex Albon)
print("Extracting Telemetry for Albom...")
albon_laps = session.laps.pick_driver('ALB')
fastest_lap = albon_laps.pick_fastest()
telemetry = fastest_lap.get_telemetry()

# 3. SIMULATE AN INCIDENT
# Let's pick a random point in the lap where the car is under stress
# (e.g., heavy braking or high speed)
random_index = random.randint(100, len(telemetry) - 100)
data_point = telemetry.iloc[random_index]

# ... (Keep the setup code at the top)

# 4. PREPARE THE REAL PAYLOAD
real_telemetry = {
    "speed": int(data_point['Speed']),
    "rpm": int(data_point['RPM']),
    "gear": int(data_point['nGear']),
    "throttle": int(data_point['Throttle']),
    "brake": int(data_point['Brake']),
    "drs": int(data_point['DRS']),
    "tire_temp": int(data_point['Speed'] / 3) + 20
}

# --- NEW LOGIC: Randomly decide if this is a Pit Stop or Radio ---
# 80% chance it's a Pit Stop
is_pit_stop = random.choice([True, True, True, True, False])

if is_pit_stop:
    event_type = "pit_stop"
    message = "Pit Stop Completed. Mediums Fitted."
    
    # Generate Albon's Time
    my_time = round(random.uniform(2.2, 3.5), 2)
    
    # Generate Field Average (e.g., Red Bull is 2.3, Kick Sauber is 4.0)
    field_avg = round(random.uniform(2.5, 3.0), 2)
    
    real_telemetry['pit_duration'] = my_time
    real_telemetry['stationary_time'] = round(my_time - 0.4, 2)
    real_telemetry['tire_compound'] = "MEDIUM"
    
    # NEW: Send the Benchmark
    real_telemetry['field_avg_pit_time'] = field_avg 
else:
    event_type = "radio"
    # Radio Logic
    if real_telemetry['brake'] > 50:
        message = "Massive locking on the fronts!"
    elif real_telemetry['rpm'] > 11000 and real_telemetry['throttle'] < 50:
        message = "Engine sync issue, losing power."
    else:
        message = "Vibration increasing on the straights."

payload = {
    "eventType": event_type,  # This tells Jira which Issue Type to use
    "driver": "Alex Albon",
    "lap": int(fastest_lap['LapNumber']),
    "message": message,
    "telemetry": real_telemetry
}
# ... (Keep the sending code at the bottom)

# 5. SEND TO JIRA
print(f"SENDING REAL DATA TO JIRA:")
print(f"Driver: {payload['driver']}")
print(f"Msg: {payload['message']}")
print(f"Telemetry: Speed={real_telemetry['speed']} | Gear={real_telemetry['gear']} | RPM={real_telemetry['rpm']}")

try:
    response = requests.post(WEBTRIGGER_URL, json=payload)
    if response.status_code == 200:
        print("SUCCESS! Ticket Created.")
    else:
        print(f"FAILED. Status: {response.status_code}")
        print(response.text)
except Exception as e:
    print(f"CONNECTION ERROR: {e}")