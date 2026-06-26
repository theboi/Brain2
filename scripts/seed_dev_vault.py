"""Seed a dev vault for the Web Console — Meridian Aerial Systems (Singapore).

Fictional drone SME demo: departments as workspaces, vaults per department,
wiki pages with [[wikilinks]], fully-backed sources, workspace members,
groups, and guest access grants.

Idempotent — safe to re-run.

  python scripts/seed_dev_vault.py            # seed
  python scripts/seed_dev_vault.py --reset    # wipe seeded state (asks first)
  python scripts/seed_dev_vault.py --reset --yes

Honours BRAIN2_DB_PATH / BRAIN2_ROOT / BRAIN2_SEED_VAULT_ROOT env vars.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

TENANT_ID = "default"
TENANT_NAME = "Meridian Aerial Systems"

# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

# role ∈ owner | member  (workspace admin role comes from workspace_members)
USERS: list[dict] = [
    # Owner / CEO
    {
        "user_id": "chua-weilin",
        "email": "weilin@meridian.sg",
        "display_name": "Chua Wei Lin",
        "role": "owner",
        "password": "meridian-dev",
    },
    # Engineering
    {
        "user_id": "priya-nair",
        "email": "priya@meridian.sg",
        "display_name": "Priya Nair",
        "role": "member",
        "password": "meridian-dev",
    },
    {
        "user_id": "rafi-halim",
        "email": "rafi@meridian.sg",
        "display_name": "Muhammad Rafi Halim",
        "role": "member",
        "password": "meridian-dev",
    },
    {
        "user_id": "darren-lim",
        "email": "darren@meridian.sg",
        "display_name": "Darren Lim",
        "role": "member",
        "password": "meridian-dev",
    },
    {
        "user_id": "tester-member",
        "email": "tester-member@meridian.sg",
        "display_name": "Tester Member (Engineering)",
        "role": "member",
        "password": "meridian-dev",
    },
    # R&D / Autonomy
    {
        "user_id": "siti-rahimah",
        "email": "siti@meridian.sg",
        "display_name": "Siti Rahimah",
        "role": "member",
        "password": "meridian-dev",
    },
    {
        "user_id": "chen-xiaobo",
        "email": "xiaobo@meridian.sg",
        "display_name": "Chen Xiao Bo",
        "role": "member",
        "password": "meridian-dev",
    },
    # Flight Operations
    {
        "user_id": "raj-kumar",
        "email": "raj@meridian.sg",
        "display_name": "Rajendran Kumar",
        "role": "member",
        "password": "meridian-dev",
    },
    {
        "user_id": "farah-tan",
        "email": "farah@meridian.sg",
        "display_name": "Farah Tan Mei Ling",
        "role": "member",
        "password": "meridian-dev",
    },
    # Regulatory & Compliance
    {
        "user_id": "joseph-tay",
        "email": "joseph@meridian.sg",
        "display_name": "Joseph Tay",
        "role": "member",
        "password": "meridian-dev",
    },
    # Sales & BD
    {
        "user_id": "aileen-ong",
        "email": "aileen@meridian.sg",
        "display_name": "Aileen Ong Hui Ying",
        "role": "member",
        "password": "meridian-dev",
    },
    # Manufacturing
    {
        "user_id": "hassan-ibrahim",
        "email": "hassan@meridian.sg",
        "display_name": "Hassan Ibrahim",
        "role": "member",
        "password": "meridian-dev",
    },
    # Finance & HR
    {
        "user_id": "wendy-goh",
        "email": "wendy@meridian.sg",
        "display_name": "Wendy Goh Siew Peng",
        "role": "member",
        "password": "meridian-dev",
    },
]

# Guest users — not workspace members, only vault access grants
GUEST_USERS: list[dict] = [
    {
        "user_id": "caas-consultant",
        "email": "compliance@caas-consult.sg",
        "display_name": "CAAS Compliance Consultant",
        "role": "member",
        "password": "guest-dev",
    },
    {
        "user_id": "cm-partner",
        "email": "bom@cm-precision.com.sg",
        "display_name": "CM Precision (Contract Manufacturer)",
        "role": "member",
        "password": "guest-dev",
    },
    {
        "user_id": "investor-east",
        "email": "deals@eastgate.vc",
        "display_name": "EastGate Ventures (Investor)",
        "role": "member",
        "password": "guest-dev",
    },
    {
        "user_id": "tester-editor",
        "email": "tester-editor@partner.example",
        "display_name": "Tester Editor (guest)",
        "role": "member",
        "password": "guest-dev",
    },
    {
        "user_id": "tester-viewer",
        "email": "tester-viewer@partner.example",
        "display_name": "Tester Viewer (guest)",
        "role": "member",
        "password": "guest-dev",
    },
]

# ---------------------------------------------------------------------------
# Workspaces (departments)
# ---------------------------------------------------------------------------

WORKSPACES: list[dict] = [
    {
        "name": "Engineering",
        "description": (
            "Firmware, avionics, flight-controller integration, and systems "
            "engineering for Meridian drone platforms."
        ),
        "head": "priya-nair",
        "members": ["rafi-halim", "darren-lim", "tester-member"],
    },
    {
        "name": "R&D / Autonomy",
        "description": (
            "Perception, path-planning, obstacle avoidance, and BVLOS "
            "autonomy stack research."
        ),
        "head": "siti-rahimah",
        "members": ["chen-xiaobo", "rafi-halim"],
    },
    {
        "name": "Flight Operations",
        "description": (
            "Pilot crew, mission planning, ground control station, and "
            "post-flight reporting."
        ),
        "head": "raj-kumar",
        "members": ["farah-tan", "darren-lim"],
    },
    {
        "name": "Regulatory & Compliance",
        "description": (
            "CAAS UA operator permits, geofencing compliance, incident "
            "reporting, and airspace advisory management."
        ),
        "head": "joseph-tay",
        "members": ["farah-tan"],
    },
    {
        "name": "Manufacturing",
        "description": (
            "Bill of materials, supplier management, assembly SOPs, "
            "and QC at Seletar facility."
        ),
        "head": "hassan-ibrahim",
        "members": ["darren-lim"],
    },
    {
        "name": "Sales & Business Development",
        "description": (
            "Customer pipeline, pricing tiers, pilot programmes, "
            "and enterprise partnerships across Singapore and SEA."
        ),
        "head": "aileen-ong",
        "members": ["wendy-goh"],
    },
    {
        "name": "Finance & HR",
        "description": (
            "Budget planning, payroll, investor reporting, "
            "and People operations."
        ),
        "head": "wendy-goh",
        "members": ["aileen-ong"],
    },
]

# ---------------------------------------------------------------------------
# Groups (cross-department squads)
# ---------------------------------------------------------------------------

GROUPS: list[dict] = [
    {
        "group_id": "autonomy-squad",
        "name": "Autonomy Squad",
        "members": ["siti-rahimah", "chen-xiaobo", "rafi-halim", "raj-kumar"],
    },
    {
        "group_id": "field-test-crew",
        "name": "Field Test Crew",
        "members": ["raj-kumar", "farah-tan", "darren-lim", "priya-nair"],
    },
    {
        "group_id": "compliance-wg",
        "name": "Compliance Working Group",
        "members": ["joseph-tay", "farah-tan", "raj-kumar", "chua-weilin"],
    },
    {
        "group_id": "leadership",
        "name": "Leadership Team",
        "members": [
            "chua-weilin", "priya-nair", "siti-rahimah", "raj-kumar",
            "joseph-tay", "aileen-ong", "hassan-ibrahim", "wendy-goh",
        ],
    },
]

# ---------------------------------------------------------------------------
# Vaults (projects) — one or more per workspace
# mode ∈ wiki | static | dynamic
# ---------------------------------------------------------------------------

_ENG_FIRMWARE = {
    "id": "firmware-engineering",
    "name": "Firmware & Avionics",
    "workspace": "Engineering",
    "mode": "wiki",
    "pages": {
        "Flight Controller Overview": """\
# Flight Controller Overview

Meridian platforms use either [[PX4 vs ArduPilot|PX4]] or [[ArduPilot]] depending
on the programme. As of Q3 2025, all new builds default to PX4 v1.15.

Key modules:
- [[Flight Controller Tuning|PID tuning]] — rate loops, attitude loops, position loops
- [[Sensor Fusion]] — EKF3, GPS/INS blending with [[RTK GPS Integration]]
- [[Failsafe Configuration]] — RC link-loss, battery critical, geofence breach

See [[Battery Management System]] for power-path firmware integration.
""",
        "PX4 vs ArduPilot": """\
# PX4 vs ArduPilot

Both open-source autopilots are supported by Meridian, though PX4 is preferred
for new programmes.

| Feature | PX4 | ArduPilot |
|---|---|---|
| Multi-vehicle | Native | Plugin |
| Gazebo sim | First-class | Supported |
| Companion comms | MAVLink / uXRCE-DDS | MAVLink |
| BVLOS maturity | High | Medium |

[[Flight Controller Overview]] describes our standard build matrix.
[[Obstacle Avoidance]] integration is tighter in PX4 via collision prevention.
""",
        "Flight Controller Tuning": """\
# Flight Controller Tuning

## Rate Loop (inner)
Typical starting point for 6 kg airframe:
- Roll/Pitch P: 0.135
- Roll/Pitch I: 0.135
- Roll/Pitch D: 0.0036

Run an Autotune flight at Seletar test ground (see [[Ground Control Station]]
for GCS setup) before customer delivery.

## Attitude Loop (outer)
Reduce AngleP from default 4.5 → 4.0 for payload-laden flights.
Payload specifics: [[Payload Integration]].

## Position Loop
Relies on accurate [[RTK GPS Integration]] for sub-10 cm hover hold.

Reference: [[Flight Controller Overview]].
""",
        "Sensor Fusion": """\
# Sensor Fusion

The EKF3 (Extended Kalman Filter) fuses:
- GPS (primary + optional [[RTK GPS Integration]])
- IMU (ICM-42688-P)
- Barometer (MS5611)
- Optical flow (PAW3902, indoor fallback)
- Magnetometer (IST8310)

All fusion coefficients are documented in the [[Flight Controller Tuning]]
parameter set. Divergence thresholds trigger the [[Failsafe Configuration]].
""",
        "Failsafe Configuration": """\
# Failsafe Configuration

Failsafes are the last line of defence before a flyaway or crash. All
Meridian builds must pass the [[Field Test SOP]] failsafe checklist.

## RC Link-Loss
- HOLD for 1 s, then RTL. Customisable via GCS (see [[Ground Control Station]]).

## Battery Critical
- Stage 1 warning: 20% → audio alert + telemetry flag.
- Stage 2 critical: 10% → forced land.

## Geofence Breach
See [[Geofencing Policy]] for Singapore CAAS airspace constraints.
Breach triggers RTL by default; BVLOS ops override to Hold pending comms.
""",
        "Battery Management System": """\
# Battery Management System

Meridian uses 6S LiPo (22.2 V nominal) and 6S Li-Ion packs.

## BMS IC: Texas Instruments BQ76952
- 16-cell series protection, balancing, coulomb counting
- I2C to Pixhawk companion port; state reported via MAVLink BATTERY_STATUS

## Charge SOP
See [[Manufacturing SOP]] for battery station procedures.

## Cycle Life
Li-Ion: 500 cycles to 80% capacity. LiPo: 200 cycles.
Log every cycle in the [[Maintenance Tracker]].

Related: [[Failsafe Configuration]] battery thresholds, [[Payload Integration]]
power budget.
""",
    },
    "sources": [
        {
            "kind": "file",
            "filename": "PX4-tuning-notes.txt",
            "mime": "text/markdown",
            "topic": "Flight Controller Tuning",
            "content": (
                "# PX4 Tuning Field Notes — Meridian MX-4 Airframe\n\n"
                "Tested at Seletar Aerospace Park open ground, 2025-05-12.\n\n"
                "## Rate loop results\n"
                "Roll P=0.135, I=0.135, D=0.0036 — oscillation-free at hover.\n"
                "Yaw P=0.20 reduced to 0.18 under 3 m/s crosswind.\n\n"
                "## Notes\n"
                "- Autotune flight ~8 min. Battery at 42% on landing.\n"
                "- Log file: session_20250512_seletar_tune.ulg\n"
                "- Next step: validate [[Failsafe Configuration]] battery thresholds.\n"
            ),
        },
        {
            "kind": "file",
            "filename": "BQ76952-datasheet.pdf",
            "mime": "text/markdown",
            "topic": "Battery Management System",
            "content": (
                "# TI BQ76952 Battery Monitor — Integration Summary\n\n"
                "Source: Texas Instruments SLUSD61B datasheet (extracted).\n\n"
                "## Key specs\n"
                "- 3–16 series cells, Li-Ion/LiPo/LiFePO4\n"
                "- Integrated cell balancing: passive, 125 mA max per cell\n"
                "- Coulomb counter accuracy: ±1% at 25°C\n"
                "- Communication: I2C (400 kHz), SMBus\n"
                "- Protection: OVP, UVP, OCD1, OCD2, SCD, OTC, UTC\n\n"
                "## Meridian integration notes\n"
                "Connected to Pixhawk 6C AUX I2C bus (3.3 V logic).\n"
                "[[Battery Management System]] firmware reads BATTERY_STATUS every 1 s.\n"
            ),
        },
    ],
}

_ENG_RTK = {
    "id": "rtk-gps-systems",
    "name": "RTK GPS & Positioning",
    "workspace": "Engineering",
    "mode": "static",
    "pages": {
        "RTK GPS Integration": """\
# RTK GPS Integration

Meridian platforms support RTK (Real-Time Kinematic) GPS for sub-5 cm
horizontal accuracy, required for precision landing and survey missions.

## Hardware
- Rover: u-blox F9P module on each drone
- Base: Trimble R12i at Seletar ground station (permanent mount)
- Link: 915 MHz telemetry radio (backup) or 4G LTE (primary)

## Software
The F9P correction stream is parsed by the [[Flight Controller Overview|PX4]]
GPS driver and fed into [[Sensor Fusion]] EKF3 as a GPS2 source.

## BVLOS relevance
Accurate position is mandatory for corridor compliance — see
[[BVLOS Operations Manual]] and [[Geofencing Policy]].
""",
        "Ground Control Station": """\
# Ground Control Station

Meridian uses QGroundControl (QGC) as the primary GCS, augmented by a
custom telemetry dashboard built on MAVLink.

## Hardware
- Rugged laptop: Panasonic Toughbook CF-33
- Telemetry radio: RFD900x (900 MHz, 40 km range)
- 4G fallback: industrial LTE router for BVLOS handoff

## Key workflows
- Pre-flight plan upload → mission items loaded via [[Flight Controller Overview]]
- Real-time [[Sensor Fusion]] health monitoring
- [[Failsafe Configuration]] override panel
- Post-flight log download → ULog → [[Maintenance Tracker]]

See [[BVLOS Operations Manual]] for BVLOS-specific GCS procedures.
""",
        "Maintenance Tracker": """\
# Maintenance Tracker

All Meridian aircraft are maintained to a 50-hour / 6-month inspection
schedule, whichever comes first.

## 50-hour checks
- Motor bell housing: inspect for cracks, bearing play
- Propellers: visual + torque check; replace if nicked
- Frame arms: ultrasonic check at welds (annual)
- [[Battery Management System]]: calibrate coulomb counter
- [[RTK GPS Integration]]: re-survey base station position

## Log sheets
Paper sign-off required per CAAS Part 149. Digital copy in [[Regulatory Knowledge Base]].

## Incident log
Any hard landing or flyaway must be entered in [[Incident Reporting SOP]].
""",
    },
    "sources": [
        {
            "kind": "file",
            "filename": "ublox-F9P-integration-guide.pdf",
            "mime": "text/markdown",
            "topic": "RTK GPS Integration",
            "content": (
                "# u-blox ZED-F9P Integration Manual (extracted)\n\n"
                "## Overview\n"
                "The ZED-F9P is a high precision GNSS module delivering RTK fix in "
                "seconds, achieving centimetre-level accuracy.\n\n"
                "## UART configuration for PX4\n"
                "- Baud: 460800\n"
                "- Protocol: UBX binary\n"
                "- Required messages: NAV-PVT, NAV-RELPOSNED, RXM-RTCM\n\n"
                "## RTCM3 corrections\n"
                "Base station must broadcast RTCM3.3 messages 1005, 1077, 1087, 1097, 1127.\n"
                "Latency budget for [[RTK GPS Integration]] corridor compliance: <200 ms.\n"
            ),
        },
    ],
}

_RD_AUTONOMY = {
    "id": "autonomy-stack",
    "name": "Autonomy Stack",
    "workspace": "R&D / Autonomy",
    "mode": "wiki",
    "pages": {
        "Obstacle Avoidance": """\
# Obstacle Avoidance

Meridian MX-4 uses a 360° collision-avoidance suite for BVLOS and confined
airspace operations.

## Sensor array
- Forward: Intel RealSense D435i (stereo RGB-D, 3 m effective)
- Side/rear: TeraRanger Evo 60 m (ToF, 0.5–60 m)
- Down: Benewake TFmini-S (40 m, landing zone)

## Fusion & planning
Point clouds from RealSense are merged with ToF scans in the
[[Autonomy Software Architecture|ROS2 costmap]]. Replanning uses DWA
(Dynamic Window Approach) with a 3 m safety bubble.

See [[Sensor Fusion]] for EKF3 integration and [[BVLOS Operations Manual]]
for operational constraints.
""",
        "Autonomy Software Architecture": """\
# Autonomy Software Architecture

The autonomy stack runs on a Jetson Orin NX (16 GB) companion computer.

## Stack overview
```
Sensors → ROS2 drivers → costmap_2d/3d → nav2 planner → PX4 offboard
```

## Key ROS2 packages
- `meridian_perception`: depth fusion, [[Obstacle Avoidance]] publisher
- `meridian_planner`: mission-adaptive path planning
- `meridian_bvlos`: corridor tracking, comms-loss handler
- `meridian_gcs_bridge`: MAVLink ↔ ROS2 relay

[[LiDAR Mapping]] data feeds the pre-mission 3D map loaded at takeoff.
[[RTK GPS Integration]] provides the odometry ground truth.
""",
        "LiDAR Mapping": """\
# LiDAR Mapping

Meridian offers LiDAR-based mapping as a payload option using the
Hesai XT32 (32-channel, 200 m range, 1.2 kg).

## Mission workflow
1. Upload KML boundary → waypoint generator outputs grid flight plan
2. Drone captures point cloud at 50 m AGL, 60% sidelap
3. Post-processing: CloudCompare → LAZ archive → customer GIS delivery

## Accuracy spec
Horizontal: ±5 cm (with [[RTK GPS Integration]])
Vertical: ±3 cm

See [[Payload Integration]] for mounting and weight-budget constraints.
Output integrated with [[Ground Control Station]] for real-time preview.
""",
        "Payload Integration": """\
# Payload Integration

Meridian MX-4 supports a 2 kg maximum payload on the quick-release belly mount.

## Standard payloads
| Payload | Mass | Interface | Notes |
|---|---|---|---|
| Sony A7R V (mapping) | 1.1 kg | USB 3.0 + trigger | 61 MP, [[LiDAR Mapping]] alt |
| Hesai XT32 LiDAR | 1.2 kg | Ethernet + GPIO | [[LiDAR Mapping]] |
| Gimbal + thermal | 0.8 kg | UART + PWM | Fire detection |
| Liquid spray nozzle | 0.7 kg | CAN bus | Agri ops |

## Gimbal Calibration
All camera gimbals must be calibrated per [[Gimbal Calibration SOP]] after
every mount/dismount cycle.

## Power budget
Payload draws from a dedicated 5 V/12 V/28 V rail controlled by the
[[Battery Management System]] companion MCU. Max payload power: 80 W.
""",
        "Gimbal Calibration SOP": """\
# Gimbal Calibration SOP

All camera gimbals must be calibrated before every survey mission.

## Procedure
1. Mount gimbal on bench jig (Seletar workshop, shelf B3)
2. Power on via lab bench supply (28 V, 3 A)
3. Open Gremsy H16 app → Run Auto-Calibration → confirm roll/pitch/yaw offsets
4. Enter final offsets in QGC payload parameters (SYS_PAYLOAD_GIM_ROLL etc.)
5. Sign off in [[Maintenance Tracker]]

## Acceptance criteria
- Roll offset < 0.3°
- Pitch offset < 0.3°
- Yaw offset < 1.0°

See [[Payload Integration]] for power rail details.
""",
    },
    "sources": [
        {
            "kind": "file",
            "filename": "hesai-XT32-datasheet.pdf",
            "mime": "text/markdown",
            "topic": "LiDAR Mapping",
            "content": (
                "# Hesai XT32 LiDAR — Technical Specifications (extracted)\n\n"
                "## Channels: 32\n"
                "## Range: 0.5–200 m (10% reflectivity)\n"
                "## Accuracy: ±2 cm\n"
                "## Point rate: 640,000 pts/s\n"
                "## FOV: 360° horizontal, -16° to +15° vertical\n"
                "## Weight: 1.24 kg (without cable)\n"
                "## Interface: Ethernet (UDP, PCAP format), PPS sync, NMEA\n\n"
                "## Integration notes\n"
                "Mounted on Meridian MX-4 belly rail. Ethernet routed to Jetson NX via "
                "unmanaged gigabit switch. PPS from [[RTK GPS Integration]] F9P for "
                "accurate point-cloud timestamping. See [[LiDAR Mapping]] for mission SOP.\n"
            ),
        },
        {
            "kind": "text",
            "filename": "obstacle-avoidance-test-results.txt",
            "mime": "text/markdown",
            "topic": "Obstacle Avoidance",
            "content": (
                "# Obstacle Avoidance Field Test — 2025-04-18, Pulau Ubin\n\n"
                "Test crew: Raj Kumar (pilot), Chen Xiao Bo (autonomy lead)\n\n"
                "## Pass criteria\n"
                "Stop-and-hold within 1.5 m of obstacle at 5 m/s approach.\n\n"
                "## Results\n"
                "| Run | Speed | Obstacle | Stop dist | Pass |\n"
                "|-----|-------|----------|-----------|------|\n"
                "| 1 | 5 m/s | 2 m wire fence | 1.1 m | Yes |\n"
                "| 2 | 5 m/s | Tree canopy | 0.9 m | Yes |\n"
                "| 3 | 8 m/s | Shipping container | 1.4 m | Yes |\n"
                "| 4 | 8 m/s | Power line sim | 1.6 m | Marginal |\n\n"
                "## Action items\n"
                "- Tune forward RealSense detection threshold for thin wires.\n"
                "- Re-run run 4 scenario after [[Obstacle Avoidance]] costmap update.\n"
            ),
        },
    ],
}

_OPS_BVLOS = {
    "id": "flight-operations",
    "name": "Flight Operations",
    "workspace": "Flight Operations",
    "mode": "wiki",
    "pages": {
        "BVLOS Operations Manual": """\
# BVLOS Operations Manual

Beyond Visual Line of Sight (BVLOS) operations at Meridian require a valid
CAAS BVLOS permit and adherence to this manual.

## Regulatory basis
CAAS Air Navigation Order (ANO) Part 14, CAAS-UAS-BVLOS-01 advisory.
See [[CAAS UA Operator Permit]] for current permit details.

## Mission planning checklist
1. File NOTAM with CAAS ≥ 24 h before flight
2. Confirm corridor in [[Geofencing Policy]] is free of temporary restrictions
3. Brief crew on [[Failsafe Configuration]] BVLOS overrides
4. Verify [[RTK GPS Integration]] base-station lock
5. Test [[Obstacle Avoidance]] in simulation (Gazebo) the day prior

## In-flight monitoring
Pilot-in-command at [[Ground Control Station]]. BVLOS spotter required at
each corridor turning-point if visual contact is possible.

## Post-flight
Complete [[Incident Reporting SOP]] (even if no incidents). Log flight
hours in [[Maintenance Tracker]].
""",
        "Geofencing Policy": """\
# Geofencing Policy

All Meridian aircraft enforce a CAAS-compliant geofence at flight time.

## Permanent exclusion zones (SG)
- Changi Airport CTR: 5 NM radius, SFC–2500 ft AMSL
- Paya Lebar Air Base: restricted area
- Tengah Air Base: restricted area
- Seletar Airport ATZ: coordinate with Seletar ATC before operations

## Dynamic exclusion
Temporary Flight Restrictions (TFRs) are pulled from CAAS NOTAM API
at mission start. [[BVLOS Operations Manual]] requires NOTAM check ≤ 2 h
before departure.

## Geofence enforcement in firmware
See [[Failsafe Configuration]] — geofence breach → RTL.
Max radius default: 500 m from launch, adjustable per permit conditions
(see [[CAAS UA Operator Permit]]).
""",
        "Ground Control Station": """\
# Ground Control Station (Ops)

See also [[Ground Control Station]] in the Engineering vault for hardware specs.

## BVLOS comms architecture
Primary: 4G LTE via industrial modem (Teltonika RUT956)
Backup: 900 MHz RFD900x, ~15 km effective range from Seletar
Emergency: ACARS-style satellite ping (Iridium 9603N)

## Telemetry dashboard
Custom web dashboard at `gcs.meridian.internal` shows:
- Live aircraft position on DJI FlySafe base map
- [[Sensor Fusion]] health indicators (EKF state, GPS HDOP)
- [[Battery Management System]] SOC and pack voltage

## Crew positions
- Pilot-in-command: licensed UA pilot (CAAS RPA-L)
- Remote observer: at each waypoint turn in BVLOS corridor
- Ground crew: Seletar launch site, handling and recovery

See [[BVLOS Operations Manual]] for full crew briefing template.
""",
        "Incident Reporting SOP": """\
# Incident Reporting SOP

All incidents (near-miss, hard landing, flyaway, injury) must be reported
within 24 hours per CAAS ANO Part 14.

## Definition of incident
- Any unplanned landing outside designated zone
- Airspace infringement
- Injury to person or property damage
- Comms loss exceeding 60 s in BVLOS operation

## Internal report (within 2 h)
1. Complete Meridian Incident Form (SharePoint / Regulatory folder)
2. Preserve flight log (.ulg) — do NOT power off aircraft until log extracted
3. Notify Head of Flight Ops and [[CAAS UA Operator Permit]] holder

## CAAS filing (within 24 h)
Submit to CAAS UAS incident portal at caas.gov.sg.

See [[Regulatory Knowledge Base]] for previous incident templates.
[[Maintenance Tracker]] must be updated if aircraft requires inspection.
""",
    },
    "sources": [
        {
            "kind": "url",
            "url": "https://www.caas.gov.sg/regulations-guidelines/aviation-safety-security/unmanned-aircraft/ua-regulatory-framework",
            "filename": "https://www.caas.gov.sg/regulations-guidelines/aviation-safety-security/unmanned-aircraft/ua-regulatory-framework",
            "mime": "text/markdown",
            "topic": "BVLOS Operations Manual",
            "content": (
                "# CAAS UA Regulatory Framework — Captured Summary\n\n"
                "Source: https://www.caas.gov.sg/regulations-guidelines/"
                "aviation-safety-security/unmanned-aircraft/ua-regulatory-framework\n\n"
                "## Applicable regulations\n"
                "- Air Navigation Order (ANO) Part 14 — Unmanned Aircraft Systems\n"
                "- CAAS-UAS-BVLOS-01 — BVLOS Operations Advisory\n"
                "- CAAS-UAS-001 — UA Operator Permit Framework\n\n"
                "## Key obligations\n"
                "Operators must hold a valid UA Operator Permit and designate "
                "a responsible person. BVLOS requires a separate approval letter "
                "for each corridor or operational area.\n\n"
                "See [[BVLOS Operations Manual]] and [[CAAS UA Operator Permit]].\n"
            ),
        },
        {
            "kind": "file",
            "filename": "BVLOS-mission-checklist.pdf",
            "mime": "text/markdown",
            "topic": "BVLOS Operations Manual",
            "content": (
                "# BVLOS Mission Pre-Flight Checklist — Meridian Aerial Systems\n\n"
                "Version: 2.1 | Approved by: Rajendran Kumar (Head of Flight Ops)\n\n"
                "## 48 h before\n"
                "- [ ] File NOTAM with CAAS online portal\n"
                "- [ ] Confirm corridor NOTAM reference received\n"
                "- [ ] Weather assessment (wind < 12 m/s, ceiling > 150 m)\n\n"
                "## Day of mission\n"
                "- [ ] NOTAM re-check ≤ 2 h before departure\n"
                "- [ ] Aircraft pre-flight per [[Maintenance Tracker]] checklist\n"
                "- [ ] [[RTK GPS Integration]] base lock confirmed (HDOP < 1.0)\n"
                "- [ ] [[Obstacle Avoidance]] system self-test passed\n"
                "- [ ] GCS comms (4G + 900 MHz backup) verified\n"
                "- [ ] Crew positions confirmed\n\n"
                "## Abort criteria\n"
                "Abort if any item fails. Complete [[Incident Reporting SOP]] if "
                "abort occurs after take-off.\n"
            ),
        },
    ],
}

_REG_COMPLIANCE = {
    "id": "regulatory-compliance",
    "name": "Regulatory Knowledge Base",
    "workspace": "Regulatory & Compliance",
    "mode": "wiki",
    "pages": {
        "CAAS UA Operator Permit": """\
# CAAS UA Operator Permit

Meridian Aerial Systems holds UA Operator Permit #UAS-OP-2024-00187,
issued by the Civil Aviation Authority of Singapore (CAAS).

## Scope
- Commercial UAS operations within Singapore FIR
- BVLOS corridor operations (with per-mission approval letter)
- Payload operations: camera, LiDAR, liquid spray

## Renewal
Permit valid 2 years from issuance (due 2026-03-15). Renewal pack:
- Updated operations manual (this [[Regulatory Knowledge Base]])
- Pilot roster with current CAAS RPA-L certificates
- Maintenance records from [[Maintenance Tracker]]
- Incident summary (see [[Incident Reporting SOP]])

## Responsible person
CEO Chua Wei Lin, SGN-UA-RP-2024-00044.

## Operating limitations
See [[Geofencing Policy]] for airspace constraints.
""",
        "Regulatory Knowledge Base": """\
# Regulatory Knowledge Base

Central index of all compliance documents for Meridian Aerial Systems.

## Live documents
- [[CAAS UA Operator Permit]] — current permit and renewal timeline
- [[Geofencing Policy]] — exclusion zones and dynamic TFR integration
- [[BVLOS Operations Manual]] — BVLOS permit conditions and procedures
- [[Incident Reporting SOP]] — mandatory reporting workflow

## Archives
Previous permit cycles and CAAS correspondence are in the Compliance
SharePoint (Regulatory folder, restricted to leadership).

## Standards
- ANO Part 14 (Singapore)
- ICAO Doc 10019 (UAS traffic management)
- ISO 21384-3 (UAS operations)

Annual compliance review scheduled every March (next: March 2026).
""",
        "Airspace Classification SG": """\
# Airspace Classification SG

Singapore airspace is divided into classes under CAAS ANO.

## Class C (controlled, IFR + VFR with clearance)
- Singapore TMA SFC–FL245
- UA operations require ATC clearance — not applicable for sub-150 m ops

## Class G (uncontrolled below 3000 ft)
Most Meridian operations take place in Class G, typically ≤120 m AGL.

## Specific zones
| Zone | Type | Notes |
|---|---|---|
| Changi CTR | Prohibited | 5 NM radius |
| One-North | Restricted | CAAS sandbox (test-flight zone) |
| Seletar ATZ | Controlled | Coordinate with Seletar ATC |
| Lim Chu Kang | Open | Agricultural drone ops approved |

References: [[CAAS UA Operator Permit]], [[Geofencing Policy]].
""",
        "Data Protection & Privacy": """\
# Data Protection & Privacy

Meridian collects aerial imagery and telemetry data subject to PDPA
(Singapore Personal Data Protection Act 2012).

## Imagery
- Survey footage that may capture persons: notify landowner, minimise
  captures, purge identifiable frames within 30 days unless needed.
- Data stored encrypted on Meridian NAS at Seletar (AES-256).

## Telemetry
Aircraft position logs are retained for 12 months (CAAS requirement),
then archived for 5 years.

## Customer data
Customer geospatial deliverables are shared via signed S3 URLs.
See [[Sales & BD Playbook]] for data-handling clauses in contracts.
""",
    },
    "sources": [
        {
            "kind": "file",
            "filename": "CAAS-UA-permit-guide.pdf",
            "mime": "text/markdown",
            "topic": "CAAS UA Operator Permit",
            "content": (
                "# CAAS UA Operator Permit Application Guide (extracted)\n\n"
                "Source: CAAS UAS Division, Form UAS-OP-01 Rev 3 (2024).\n\n"
                "## Required documents\n"
                "1. Operations Manual (Part A: Organisation, Part B: Procedures)\n"
                "2. Risk Assessment (SORA or equivalent)\n"
                "3. Insurance certificate (minimum SGD 1 million third-party)\n"
                "4. Maintenance Programme summary\n"
                "5. Pilot roster with CAAS RPA-L licence numbers\n\n"
                "## Processing time\n"
                "Standard: 28 business days. Expedited (fee): 14 business days.\n\n"
                "## Permit conditions\n"
                "- Comply with ANO Part 14 at all times\n"
                "- File NOTAM for each operational day\n"
                "- Carry permit copy on site (digital copy acceptable)\n\n"
                "See [[CAAS UA Operator Permit]] for Meridian's current permit details.\n"
            ),
        },
        {
            "kind": "url",
            "url": "https://www.caas.gov.sg/regulations-guidelines/aviation-safety-security/unmanned-aircraft/ua-operator-permit",
            "filename": "https://www.caas.gov.sg/regulations-guidelines/aviation-safety-security/unmanned-aircraft/ua-operator-permit",
            "mime": "text/markdown",
            "topic": "CAAS UA Operator Permit",
            "content": (
                "# CAAS UA Operator Permit — Official Page (captured)\n\n"
                "Source: https://www.caas.gov.sg/regulations-guidelines/"
                "aviation-safety-security/unmanned-aircraft/ua-operator-permit\n\n"
                "The UA Operator Permit (UAOP) authorises a company or individual "
                "to conduct commercial UAS operations in Singapore. The permit "
                "is required for any operation for renumeration or hire, or any "
                "operation beyond 60 m AGL in Class G airspace.\n\n"
                "Application via Bizfile+/CorpPass. Processing 28 days.\n\n"
                "References: [[CAAS UA Operator Permit]], [[Regulatory Knowledge Base]].\n"
            ),
        },
    ],
}

_MFG_BOM = {
    "id": "manufacturing-bom",
    "name": "Manufacturing & BOM",
    "workspace": "Manufacturing",
    "mode": "dynamic",
    "pages": {
        "Bill of Materials MX-4": """\
# Bill of Materials — MX-4 Platform

Meridian MX-4 is our production hexacopter (take-off weight ≤ 7 kg with
standard payload). BOM version: v3.2, effective Q4 2025.

## Major assemblies
| Assembly | Part no. | Supplier | Lead time |
|---|---|---|---|
| Carbon frame set | MXF-CF-6AX-01 | SG CarbonTech | 3 weeks |
| Motor (×6) | MXM-T-5008-400KV | T-Motor SG | 1 week |
| ESC (×6) | TESC-F45A-32bit | T-Motor SG | 1 week |
| Flight controller | Pixhawk 6C | Holybro (direct) | 2 weeks |
| Companion computer | Jetson Orin NX 16 GB | NVIDIA (Arrow SG) | 4 weeks |
| RTK module | ZED-F9P | ublox (Mouser SG) | 2 weeks |
| Battery (Li-Ion 6S) | MXB-LI-22000 | Grepow (FOB SG) | 3 weeks |

Full BOM spreadsheet: [[BOM Change Log]] for revisions.
See [[Supplier List]] for qualification status.
""",
        "BOM Change Log": """\
# BOM Change Log

| Version | Date | Change | Approved by |
|---|---|---|---|
| v3.2 | 2025-10-01 | ESC upgraded from F40A to F45A (higher thermal margin) | Hassan Ibrahim |
| v3.1 | 2025-07-15 | Companion switched Jetson Xavier → Orin NX (2× perf) | Siti Rahimah |
| v3.0 | 2025-04-01 | Frame v2 → v3 (arm stiffness +18%) | Priya Nair |
| v2.5 | 2025-01-10 | RTK module: Here3+ → ZED-F9P | Priya Nair |

[[Bill of Materials MX-4]] reflects the current v3.2 BOM.
[[Supplier List]] updated alongside each BOM change.
""",
        "Supplier List": """\
# Supplier List

Meridian qualifies suppliers under ISO 9001 criteria. Qualification
review annually or after significant change.

## Qualified suppliers (Q4 2025)
| Supplier | Category | Status | Next review |
|---|---|---|---|
| SG CarbonTech | Structural composites | Approved | 2026-03 |
| T-Motor Singapore | Motors & ESC | Approved | 2026-06 |
| Holybro | Flight controllers | Approved | 2026-06 |
| Arrow SG / NVIDIA | Jetson modules | Approved | 2026-01 |
| Grepow | Lithium battery packs | Approved | 2026-03 |
| Mouser Electronics | Electronic components | Approved | Ongoing |
| CM Precision Pte Ltd | Sub-assembly (contract) | Approved | 2026-01 |

CM Precision is our contract manufacturer for frame and arm sub-assemblies.
See [[Manufacturing SOP]] for sub-contracting quality gates.
""",
        "Manufacturing SOP": """\
# Manufacturing SOP

Assembly is performed at Meridian's Seletar workshop (Block 31, Seletar
Aerospace Park) and at CM Precision's facility (Tuas).

## Production flow
1. Parts receiving & incoming inspection (IQC checklist)
2. Sub-assembly: frame arms at CM Precision → incoming QC at Seletar
3. Motor/ESC installation (torque spec: M3 screws 0.8 N·m)
4. Wiring harness routing (see PCB harness diagram v3.2)
5. Avionics installation: Pixhawk 6C, Jetson Orin NX, F9P RTK
6. Software flash: [[Flight Controller Overview]] firmware, Jetson OS image
7. Bench test: motor spin test, sensor check, GPS lock
8. Battery station: initial charge, BMS commissioning (see [[Battery Management System]])
9. Final QC sign-off → release to [[BVLOS Operations Manual|ops]]

## Traceability
Each aircraft receives a serial number (MXS-YYMM-NNN). Log in asset tracker.
""",
        "Quality Control Checklist": """\
# Quality Control Checklist

Use this checklist before releasing any MX-4 aircraft from assembly.

## Mechanical
- [ ] All M3 motor screws at 0.8 N·m (torque wrench record)
- [ ] Propeller balance <0.5 g·cm imbalance
- [ ] Frame arm flex test (3 mm deflection max at 5 N lateral)
- [ ] Cable routing clear of spinning parts

## Avionics
- [ ] Pixhawk 6C firmware flashed ([[Flight Controller Overview]] version)
- [ ] [[Sensor Fusion]] calibration completed (accel, compass, airspeed)
- [ ] [[RTK GPS Integration]] F9P firmware updated, UART configured
- [ ] [[Battery Management System]] BMS commissioned, cell voltages balanced

## Software
- [ ] Jetson Orin NX autonomy image deployed ([[Autonomy Software Architecture]])
- [ ] [[Obstacle Avoidance]] sensors operational (self-test pass)
- [ ] GCS pairing with drone serial verified ([[Ground Control Station]])

## Final
- [ ] 5-minute hover test at Seletar test ground
- [ ] Log file reviewed for anomalies
- [ ] Sign-off by QC lead and Head of Engineering
""",
    },
    "sources": [
        {
            "kind": "file",
            "filename": "T-Motor-5008-spec-sheet.pdf",
            "mime": "text/markdown",
            "topic": "Bill of Materials MX-4",
            "content": (
                "# T-Motor MN5008 KV400 — Technical Specifications (extracted)\n\n"
                "## Motor specs\n"
                "- KV: 400 rpm/V\n"
                "- Max power: 1100 W\n"
                "- Max thrust (18-inch prop): 4.2 kg\n"
                "- Weight: 195 g\n"
                "- Stator: 50×24 mm\n"
                "- Shaft: 8 mm (M4 thread)\n\n"
                "## Integration notes\n"
                "6× motors total on MX-4 hexacopter. Each motor paired with F45A ESC "
                "(see [[Bill of Materials MX-4]] v3.2). Max combined thrust 25.2 kg; "
                "7 kg MTOW gives 3.6× thrust-to-weight ratio — sufficient for "
                "4 m/s vertical climb with full [[Payload Integration]].\n"
            ),
        },
        {
            "kind": "file",
            "filename": "seletar-workshop-layout.txt",
            "mime": "text/markdown",
            "topic": "Manufacturing SOP",
            "content": (
                "# Seletar Workshop Layout — Block 31, Seletar Aerospace Park\n\n"
                "## Zones\n"
                "- Zone A (200 m²): Parts receiving, IQC benches, racking\n"
                "- Zone B (150 m²): Frame & arm assembly, torque-wrench station\n"
                "- Zone C (120 m²): Avionics integration, clean bench, ESD mats\n"
                "- Zone D (80 m²): Battery station (ventilated, fire-rated rack)\n"
                "- Zone E (outdoor, 400 m²): Ground test pad (concrete), 20 m × 20 m cage\n\n"
                "## Access\n"
                "Swipe card required. Visitors sign in at reception.\n"
                "CAAS accredited facility — notify CAAS inspector 24 h before audit visits.\n\n"
                "[[Manufacturing SOP]] references bench locations (B3 for gimbal jig, etc.).\n"
            ),
        },
    ],
}

_SALES = {
    "id": "sales-bd",
    "name": "Sales & BD Playbook",
    "workspace": "Sales & Business Development",
    "mode": "wiki",
    "pages": {
        "Customer Pilot Programme": """\
# Customer Pilot Programme

Meridian runs structured 30-day proof-of-concept pilots for enterprise
customers before full deployment.

## Pilot package
- 1× MX-4 aircraft (loaner)
- 5 supervised flight days with Meridian pilot
- Deliverables: survey maps or inspection reports per agreed use-case
- Pricing: SGD 18,000 flat (deductible from contract value)

## Current pilots (Q4 2025)
| Customer | Use-case | Start | Status |
|---|---|---|---|
| JTC Corporation | Industrial estate inspection | Oct 2025 | Active |
| NParks | Tree-canopy mapping, Bukit Timah | Nov 2025 | Active |
| Port of Singapore | Vessel hull inspection (trial) | Dec 2025 | Upcoming |

See [[Pricing Tiers]] for full commercial pricing.
[[BVLOS Operations Manual]] applies to all pilot missions.
""",
        "Pricing Tiers": """\
# Pricing Tiers

Meridian commercial pricing (SGD, excl. GST), effective Q4 2025.

## Aircraft lease
| Tier | Duration | Price/month | Notes |
|---|---|---|---|
| Starter | 3 months | 9,800 | 1 aircraft, standard payload |
| Growth | 12 months | 8,500 | Up to 3 aircraft, priority support |
| Enterprise | 24 months | 7,200 | Fleet of 5+, custom SLA |

## Managed service (flight ops included)
| Tier | Days/month | Price/day | Notes |
|---|---|---|---|
| Basic | Up to 5 | 4,200 | 1 pilot, 1 aircraft |
| Pro | 6–15 | 3,800 | 1 pilot, 2 aircraft, report delivery |
| Enterprise | 16+ | Custom | Dedicated ops team |

## Add-ons
- RTK-grade survey deliverables: +SGD 1,200/day
- LiDAR mapping: +SGD 1,800/day
- Thermal payload: +SGD 900/day

See [[Customer Pilot Programme]] and [[Sales & BD Playbook]].
""",
        "Sales & BD Playbook": """\
# Sales & BD Playbook

Meridian target segments for 2026:
1. Government / statutory boards (JTC, HDB, NParks, PUB)
2. Ports and logistics (PSA, Jurong Port)
3. Infrastructure inspection (civil engineering, telecoms)
4. Agriculture (Lim Chu Kang farms — pilot season starting Q1 2026)

## Sales cycle
1. Lead qualification → demo flight at Seletar test ground
2. [[Customer Pilot Programme]] proposal (30 days)
3. Commercial offer referencing [[Pricing Tiers]]
4. Contract review — data-handling clause (see [[Data Protection & Privacy]])
5. Onboarding: ops briefing, CAAS compliance notes for customer site

## Key contacts
- JTC account: Aileen Ong (primary), CEO Chua Wei Lin (exec sponsor)
- Government BD: Joseph Tay (compliance co-lead for regulated sites)

## Pipeline review
Fortnightly pipeline call every other Monday at 09:00 SGT.
""",
        "Market Overview SEA": """\
# Market Overview — SEA Commercial Drone 2025–2027

## Market size
Commercial drone services in SEA estimated at USD 420 M in 2025,
growing to USD 1.1 B by 2027 (Frost & Sullivan).

## Singapore addressable market
Focus areas:
- Inspection (infrastructure, utilities): USD 35 M
- Mapping & surveying: USD 22 M
- Agriculture: USD 8 M (early stage)
- Security & surveillance: regulated, complex entry

## Competitors
| Player | Strength | Weakness |
|---|---|---|
| Garuda Robotics | Strong SG ops | No BVLOS permit |
| Swarm Fund portfolio | VC-backed | Pre-revenue |
| DJI Enterprise | Brand/product | No local ops |
| Aerodyne (MY) | SEA coverage | Less SG focus |

Meridian differentiator: BVLOS permit holder, local workshop, regulatory expertise
([[CAAS UA Operator Permit]]).
""",
    },
    "sources": [
        {
            "kind": "text",
            "filename": "JTC-pilot-brief.txt",
            "mime": "text/markdown",
            "topic": "Customer Pilot Programme",
            "content": (
                "# JTC Corporation — Drone Inspection Pilot Brief\n\n"
                "Prepared by: Aileen Ong, Head of Sales & BD\n"
                "Date: 2025-09-30\n\n"
                "## Scope\n"
                "Inspection of JTC industrial estates (Tuas, Jurong East, "
                "Woodlands) using Meridian MX-4 + gimbal thermal payload.\n\n"
                "## Deliverables\n"
                "- Weekly inspection report with annotated thermal imagery\n"
                "- Anomaly alerts (hot spots, structural issues) within 4 hours of flight\n\n"
                "## Timeline\n"
                "- Pilot start: Oct 2025 (under [[Customer Pilot Programme]] terms)\n"
                "- Evaluation: Dec 2025 — go/no-go for 12-month managed service\n\n"
                "## Commercials\n"
                "Pilot at SGD 18,000 (see [[Pricing Tiers]]). "
                "Full managed service: estimated SGD 55,000/month (Pro tier, 3 aircraft).\n"
            ),
        },
    ],
}

_FIN_HR = {
    "id": "finance-hr",
    "name": "Finance & HR",
    "workspace": "Finance & HR",
    "mode": "static",
    "pages": {
        "Budget FY2026": """\
# Budget — FY2026

Meridian Aerial Systems FY2026 budget (SGD, unaudited draft).

## Revenue forecast
| Segment | Q1 | Q2 | Q3 | Q4 | Total |
|---|---|---|---|---|---|
| Managed service | 180k | 220k | 310k | 380k | 1,090k |
| Lease | 45k | 60k | 75k | 90k | 270k |
| One-off projects | 60k | 80k | 100k | 120k | 360k |
| **Total** | **285k** | **360k** | **485k** | **590k** | **1,720k** |

## Headcount plan
Current: 12 FTE. Plan: +3 by Q2 (1 Eng, 1 Ops pilot, 1 Sales).
Payroll est.: SGD 120k/month fully loaded by Q3.

## Capex
- 2× MX-4 aircraft builds: SGD 95k each
- Seletar workshop expansion (Zone D upgrade): SGD 40k

Related: [[Investor Update Q3 2025]].
""",
        "Investor Update Q3 2025": """\
# Investor Update — Q3 2025

Prepared for EastGate Ventures and seed investors. Confidential.

## Highlights
- Revenue: SGD 312k (Q3 actuals), +38% QoQ
- BVLOS permit #UAS-OP-2024-00187 renewed (see [[CAAS UA Operator Permit]])
- JTC pilot signed — potential SGD 55k/month contract from Q1 2026
- 2 new MX-4 builds completed (total fleet: 5 aircraft)

## Key metrics
| Metric | Q2 2025 | Q3 2025 | Target Q4 |
|---|---|---|---|
| Flight hours | 380 h | 510 h | 650 h |
| Incident rate | 0.8% | 0.4% | <0.5% |
| Customer NPS | 62 | 71 | ≥70 |

## Burn & runway
Monthly burn: SGD 195k. Cash on hand: SGD 1.4 M. Runway: ~7 months.
Series A targeting H1 2026 at SGD 5 M raise.

See [[Budget FY2026]] for FY2026 plan.
""",
        "Payroll & HR Policy": """\
# Payroll & HR Policy

## Pay cycle
Monthly, credited on last working day. CPF contributions per statutory rates.

## Leave entitlement
- Annual leave: 14 days (years 1–2), 18 days (years 3–5), 21 days (year 6+)
- Medical: 14 outpatient days, 60 hospitalisation days (MOM statutory)
- Paternity/maternity: as per GPML Act

## Performance review
Annual in December. Mid-year check-in in June.
Promotion recommendations go to CEO for approval.

## Expense claims
Submit via Xero by the 5th of each month. Receipts required > SGD 50.
Pre-approval needed for single expenses > SGD 500.
""",
        "Headcount & Org Chart": """\
# Headcount & Org Chart

## Leadership (as of Q4 2025)
- CEO: Chua Wei Lin
- Head of Engineering: Priya Nair
- Head of R&D/Autonomy: Siti Rahimah
- Head of Flight Ops: Rajendran Kumar
- Head of Regulatory: Joseph Tay
- Head of Sales & BD: Aileen Ong
- Head of Manufacturing: Hassan Ibrahim
- Finance & HR lead: Wendy Goh

## FTE by department
| Department | FTE |
|---|---|
| Engineering | 3 (Priya, Rafi, Darren) |
| R&D / Autonomy | 2 (Siti, Xiao Bo) |
| Flight Ops | 2 (Raj, Farah) |
| Regulatory | 1 (Joseph) |
| Manufacturing | 1 (Hassan) |
| Sales & BD | 1 (Aileen) |
| Finance & HR | 1 (Wendy) |
| CEO office | 1 (Wei Lin) |
| **Total** | **12** |

See [[Budget FY2026]] for planned headcount changes.
""",
    },
    "sources": [
        {
            "kind": "text",
            "filename": "FY2026-budget-workings.txt",
            "mime": "text/markdown",
            "topic": "Budget FY2026",
            "content": (
                "# FY2026 Budget Workings — Draft Notes\n\n"
                "Prepared by: Wendy Goh\n"
                "Reviewed by: Chua Wei Lin\n\n"
                "## Revenue assumptions\n"
                "- JTC contract converts Q1 2026: SGD 55k/month × 9 months = SGD 495k\n"
                "- NParks seasonal: 3 months × SGD 38k = SGD 114k\n"
                "- Pipeline conversion: 20% of SGD 2.1 M pipeline closes by Q3\n\n"
                "## Opex assumptions\n"
                "- Salaries: 12 FTE avg SGD 8.5k/month → SGD 1,224k annual\n"
                "- Workshop rent (Seletar): SGD 18k/month\n"
                "- Insurance (hull + liability): SGD 85k annual\n"
                "- R&D materials: SGD 60k (sensor prototypes)\n\n"
                "See [[Budget FY2026]] for consolidated view.\n"
            ),
        },
        {
            "kind": "file",
            "filename": "insurance-certificate-2025.pdf",
            "mime": "text/markdown",
            "topic": "Budget FY2026",
            "content": (
                "# UAS Liability Insurance Certificate — Summary (extracted)\n\n"
                "Insurer: Chubb Insurance Singapore\n"
                "Policy no.: CUB-SG-UAS-2025-08841\n"
                "Period: 1 Jan 2025 – 31 Dec 2025\n\n"
                "## Cover\n"
                "- Third-party bodily injury & property damage: SGD 5,000,000 per occurrence\n"
                "- Hull (per aircraft): SGD 95,000 replacement value\n"
                "- Operators covered: all CAAS RPA-L licence holders on approved roster\n\n"
                "## Conditions\n"
                "- Operations within Singapore FIR only (excluding prohibited areas)\n"
                "- BVLOS operations covered with valid CAAS BVLOS approval letter per mission\n"
                "- Notify insurer within 48 h of incident (see [[Incident Reporting SOP]])\n\n"
                "Required for [[CAAS UA Operator Permit]] renewal.\n"
            ),
        },
    ],
}

# All vaults in order
VAULTS: list[dict] = [
    _ENG_FIRMWARE,
    _ENG_RTK,
    _RD_AUTONOMY,
    _OPS_BVLOS,
    _REG_COMPLIANCE,
    _MFG_BOM,
    _SALES,
    _FIN_HR,
]

# Guest access grants: (guest_user_id, vault_id, role)
GUEST_GRANTS: list[tuple[str, str, str]] = [
    ("caas-consultant", "regulatory-compliance", "viewer"),
    ("cm-partner", "manufacturing-bom", "editor"),
    ("investor-east", "finance-hr", "viewer"),
    ("tester-editor", "firmware-engineering", "editor"),
    ("tester-viewer", "firmware-engineering", "viewer"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_root() -> Path:
    return Path(os.environ.get(
        "BRAIN2_SEED_VAULT_ROOT",
        str(Path.home() / "Knowledge" / "Brain2DevSeed")))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _ensure_tenant(s) -> None:
    if s.get_tenant(TENANT_ID) is None:
        s.create_tenant(TENANT_ID, TENANT_NAME)


def _ensure_user(actx, user: dict) -> None:
    s = actx.store
    if s.get_user_id_by_email(TENANT_ID, user["email"]) is None:
        s.create_user(
            TENANT_ID, user["user_id"], user["email"], user["role"],
            display_name=user.get("display_name"),
        )
        actx.passwords.set_password(TENANT_ID, user["user_id"], user["password"])


def _ensure_workspace(s, name: str) -> str:
    """Return existing or create new workspace; return workspace_id."""
    for w in s.list_workspaces(TENANT_ID):
        if w.name == name:
            return w.workspace_id
    return s.create_workspace(TENANT_ID, name).workspace_id


def _ensure_workspace_description(s, workspace_id: str, description: str) -> None:
    """Set workspace description (idempotent via UPDATE)."""
    s.update_workspace(TENANT_ID, workspace_id, description=description)


def _ensure_project(s, project_id: str, name: str, workspace_id: str,
                    vault_path: Path, mode: str) -> None:
    existing = s.get_project(TENANT_ID, project_id)
    if existing is None:
        s.create_project(TENANT_ID, project_id, name, workspace_id=workspace_id)
    elif existing.workspace_id != workspace_id:
        s.set_project_workspace(TENANT_ID, project_id, workspace_id)
    # set_project_mode / vault_path are idempotent (UPDATE)
    s.set_project_mode(TENANT_ID, project_id, mode)
    s.set_project_vault_path(TENANT_ID, project_id, str(vault_path))


def _ensure_vault_dir(root: Path, vault_id: str, vault_name: str) -> Path:
    from brain2.vault.init import init_vault_tree
    from brain2.vault.git import git_init_vault
    vault = root / vault_id
    if not vault.exists():
        init_vault_tree(vault)
        git_init_vault(vault, project_name=vault_name, tenant_id=TENANT_ID,
                       project_id=vault_id)
    return vault


def _write_pages(vault: Path, pages: dict[str, str]) -> None:
    from brain2.vault.fs import write_text_atomic
    wiki = vault / "wiki"
    wiki.mkdir(parents=True, exist_ok=True)
    for topic, body in pages.items():
        fp = wiki / f"{topic}.md"
        if not fp.exists():
            write_text_atomic(fp, body)


def _seed_sources(actx, project_id: str, sources: list[dict]) -> None:
    """Seed sources through the real ingest pipeline (fully backed: Raw + Extracted)."""
    from brain2.source_ops import create_source_row, set_source_extracted
    s = actx.store
    for src in sources:
        ident = src.get("filename") or src.get("url")
        existing = s._conn.execute(
            "SELECT source_id, blob_hash FROM sources WHERE tenant_id=? "
            "AND project_id=? AND (filename=? OR url=?)",
            (TENANT_ID, project_id, ident, ident),
        ).fetchone()
        if existing and existing["blob_hash"]:
            continue  # already fully seeded
        if existing:
            # Drop empty placeholder and recreate with real blob
            s._conn.execute(
                "DELETE FROM source_extractions WHERE tenant_id=? AND source_id=?",
                (TENANT_ID, existing["source_id"]))
            s._conn.execute(
                "DELETE FROM sources WHERE tenant_id=? AND source_id=?",
                (TENANT_ID, existing["source_id"]))
            s._conn.commit()
        data = src["content"].encode("utf-8")
        blob_hash, blob_path = actx.blob_store.put(TENANT_ID, data)
        source_id = create_source_row(
            s, tenant_id=TENANT_ID, project_id=project_id, kind=src["kind"],
            filename=src.get("filename"), url=src.get("url"),
            mime=src.get("mime", "text/markdown"), size_bytes=len(data),
            blob_hash=blob_hash, blob_path=blob_path, topic=src.get("topic"),
        )
        set_source_extracted(
            s, tenant_id=TENANT_ID, source_id=source_id,
            extracted_md=src["content"], kind="upload",
        )


def _seed_vault(actx, vault_def: dict, workspace_ids: dict[str, str]) -> None:
    from brain2.vault.indexer import reindex_vault
    s = actx.store
    ws_name = vault_def["workspace"]
    wid = workspace_ids[ws_name]
    vault_path = _ensure_vault_dir(_seed_root(), vault_def["id"], vault_def["name"])
    _ensure_project(s, vault_def["id"], vault_def["name"], wid, vault_path,
                    vault_def["mode"])
    _write_pages(vault_path, vault_def["pages"])
    reindex_vault(s, vault_def["id"], vault_path)
    _seed_sources(actx, vault_def["id"], vault_def["sources"])


def _ensure_workspace_members(s, workspace_id: str, ws_def: dict) -> None:
    """Set workspace admin (department head) and members. Idempotent."""
    head_id = ws_def["head"]
    # Ensure head is admin
    current = s.get_workspace_member_role(TENANT_ID, workspace_id, head_id)
    if current is None:
        s.add_workspace_member(TENANT_ID, workspace_id, head_id, "admin")
    elif current != "admin":
        s.set_workspace_member_role(TENANT_ID, workspace_id, head_id, "admin")

    for member_id in ws_def.get("members", []):
        current = s.get_workspace_member_role(TENANT_ID, workspace_id, member_id)
        if current is None:
            s.add_workspace_member(TENANT_ID, workspace_id, member_id, "member")


def _ensure_group(s, group: dict) -> None:
    """Create group and members if not already present. Silently skips on conflict."""
    try:
        s.create_group(TENANT_ID, group["group_id"], group["name"])
    except Exception:
        pass  # already exists
    for user_id in group["members"]:
        try:
            s.add_group_member(TENANT_ID, group["group_id"], user_id)
        except Exception:
            pass  # already a member


def _ensure_guest_grants(s) -> None:
    """Grant external (guest) users view/edit access to specific vaults."""
    for user_id, project_id, role in GUEST_GRANTS:
        s.grant_access(TENANT_ID, project_id, "user", user_id, role)


def _reset() -> None:
    seed_root = _seed_root()
    if seed_root.exists():
        shutil.rmtree(seed_root)
    db_path = Path(os.environ.get(
        "BRAIN2_DB_PATH", str(Path.home() / "Knowledge" / "Brain2" / "brain2.sqlite")))
    for suffix in ("", "-shm", "-wal"):
        p = db_path.parent / (db_path.name + suffix)
        if p.exists():
            p.unlink()


# ---------------------------------------------------------------------------
# Public entry-point (also called by setup.py --with-seed)
# ---------------------------------------------------------------------------

def run_seed() -> None:
    """Full idempotent seed for Meridian Aerial Systems demo data."""
    from brain2.app_context import build_app_context
    actx = build_app_context()
    s = actx.store

    # Tenant
    _ensure_tenant(s)

    # Users (internal staff)
    for user in USERS:
        _ensure_user(actx, user)

    # Guest users
    for user in GUEST_USERS:
        _ensure_user(actx, user)

    # Workspaces and their members
    workspace_ids: dict[str, str] = {}
    for ws_def in WORKSPACES:
        wid = _ensure_workspace(s, ws_def["name"])
        workspace_ids[ws_def["name"]] = wid
        _ensure_workspace_description(s, wid, ws_def.get("description", ""))
        _ensure_workspace_members(s, wid, ws_def)

    # Groups
    for group in GROUPS:
        _ensure_group(s, group)

    # Vaults (projects + pages + sources)
    for vault_def in VAULTS:
        _seed_vault(actx, vault_def, workspace_ids)

    # Guest access grants
    _ensure_guest_grants(s)

    print("seeded: Meridian Aerial Systems")
    print(f"  vault root : {_seed_root()}")
    print(f"  users      : {len(USERS)} staff + {len(GUEST_USERS)} guests")
    print(f"  workspaces : {len(WORKSPACES)}")
    print(f"  vaults     : {len(VAULTS)}")
    print(f"  groups     : {len(GROUPS)}")
    print()
    print("  owner login  : weilin@meridian.sg / meridian-dev")
    print("  guest logins : compliance@caas-consult.sg / guest-dev")
    print("                 bom@cm-precision.com.sg / guest-dev")
    print("                 deals@eastgate.vc / guest-dev")


def main(reset: bool = False, confirm: bool | None = None) -> None:
    if reset:
        if confirm is None:
            ans = input(
                f"Wipe {_seed_root()} and "
                f"{os.environ.get('BRAIN2_DB_PATH', '<default>')}? [y/N] "
            )
            confirm = ans.strip().lower() == "y"
        if not confirm:
            print("aborted")
            sys.exit(2)
        _reset()
        print("reset done")
        return

    run_seed()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    p.add_argument("--yes", action="store_true", help="confirm --reset non-interactively")
    args = p.parse_args()
    main(reset=args.reset, confirm=True if args.yes else None)
