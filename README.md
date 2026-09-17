# Coffee Terminal Simulator

> A desktop software simulator for automated coffee-machine terminals.

[简体中文](README.zh-CN.md) · [Documentation index](docs/README.md) · [Coffee Cloud backend](https://github.com/woodbridgehi/coffee-cloud-mvp)

Coffee Terminal Simulator is a Python and pywebview application for end-to-end integration testing with the Coffee Cloud backend. It models the software responsibilities of a connected coffee terminal without requiring physical hardware.

## What it provides

- Displays the cloud-provided ordering QR code and terminal status.
- Publishes locally configured recipes, capabilities, and material availability.
- Receives production tasks from the cloud and executes them step by step.
- Reserves, consumes, replenishes, and persists shared material inventory.
- Simulates failures, retries, pauses, cancellations, recovery holds, and network interruptions.
- Sends heartbeats, capability snapshots, inventory snapshots, and device events to the cloud.
- Provides a local device API and a developer console for integration testing.
- Supports local mode, HTTP remote mode, MQTT 5 remote mode, simulator pairing, and credential rotation.

The simulator includes a Three.js kinematic illustration, but no rigid-body/contact simulation or real hardware control. It does not process real payments or decide refunds. Customer-facing clients use the cloud menu and order APIs; they never connect directly to the simulator's local API.

## Architecture

```text
Local JSON configuration
        ↓
Terminal runtime + SQLite state
        ↓ HTTP or MQTT 5
Coffee Cloud backend
        ↓
Merchant menu, orders, commands, inventory and operations UI
```

The device remains authoritative for recipe execution and physical-material simulation. The cloud stores the latest device-reported snapshots and applies merchant, order, payment, and lifecycle rules.

## Repository layout

```text
coffee-terminal-simulator/
├── coffee-terminal/       # Runtime, transport, local API and web UI
├── config/instances/      # One directory per simulated terminal
├── scripts/               # Activation, credential, headless and launch tools
├── tests/                 # Python and browser-oriented integration tests
├── ACTIVATION.md          # Registration, activation and credential rotation
├── CHANGELOG.md           # Release history
├── start-instance.command # Launch one instance
└── start-all.command      # Launch every configured instance
```

Each instance normally contains:

```text
device.json               # Identity, store and backend settings
recipes/*.json            # One supported drink per file
materials.json            # Shared material definitions and initial stock
failures.json             # Failure simulation policy
state/                    # Runtime SQLite and mutable inventory state
```

## Quick start

The project uses `uv` and Python 3.12:

```bash
cd /Users/alex/Downloads/armaster/coffee-terminal-simulator
uv venv --managed-python --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.lock
```

Launch one instance:

```bash
./start-instance.command coffee-bot-001
```

Launch all configured instances:

```bash
./start-all.command
```

For a pywebview debug window:

```bash
.venv/bin/python scripts/start_instance.py coffee-bot-001 --debug
```

For headless remote integration tests:

```bash
.venv/bin/python scripts/run_headless.py coffee-bot-002 \
  --env-file .secrets/coffee-bot-002.env --duration 60
```

## Included demo instances

| Instance | City | Store | Drinks | Local API |
| --- | --- | --- | ---: | ---: |
| `coffee-bot-003` | Beijing | See instance configuration | 10 | `9103` |
| `coffee-bot-004` | Shanghai | Shanghai Jing'an Demo Store | 4 | `9104` |
| `coffee-bot-005` | Shenzhen | Shenzhen Nanshan Demo Store | 4 | `9105` |

These are repository examples, not a statement about the current running deployment. Remote instances with credentials can connect to the configured cloud and affect its tasks and simulated inventory; use isolated instances for testing.

## Local and remote modes

Set `backend.mode` in an instance's `device.json`:

- `local`: no cloud connection; the developer console creates and controls local test jobs.
- `remote`: connects to the configured cloud using HTTP polling or MQTT 5. Orders and production commands go through the cloud.

The transport is selected with `backend.transport` (`http` or `mqtt5`). The remote workflow is:

```text
Device heartbeat → cloud menu/order → production command → local execution
       ↑                                             ↓
 capability + inventory snapshots ← device events/results
```

By default, heartbeats are sent every 30 seconds. Full capability and inventory snapshots are uploaded at startup and whenever their local versions change. If the device is offline, the cloud retains the last successfully received snapshot.

## Pairing and credentials

Remote onboarding creates a software identity, completes a one-time pairing flow, and stores the device token and MQTT credentials locally. Existing activation and rotation tools are:

```bash
.venv/bin/python scripts/activate_instance.py <instance> \
  --activation-code-file .secrets/<instance>.activation-code \
  --secrets-file .secrets/<instance>.env

.venv/bin/python scripts/rotate_instance_credential.py <instance> \
  --secrets-file .secrets/<instance>.env
```

Never commit `.secrets/`, `.identity/`, private keys, activation codes, or production credentials. The simulator stores secrets in Git-ignored files with restricted permissions.

## Recipes, materials and inventory

Recipes and material definitions are device-local JSON files. The runtime validates recipes, calculates supported capabilities and maximum servings, and persists mutable inventory, jobs, and outgoing events together in `state/runtime.db`. Legacy `state/inventory.json` is imported once when SQLite has no inventory; subsequent edits to that JSON do not change live stock. Stop the simulator before backing up the complete `state/` directory. A configuration reload or restart is required after editing recipe or material definitions directly. Inventory adjustments, reservations, consumption, and releases automatically increment the inventory version and trigger a cloud snapshot update in remote mode.

## Testing

```bash
.venv/bin/python -m pytest -q
npm test
```

The runtime dependency lock does not include the Python test tools; install `pytest` and `pytest-subtests` into the development environment separately. `unittest discover` alone misses the pytest-style cases. Node.js is required for `npm test`. See the [documentation index](docs/README.md) for the protocol and test references.

## Documentation

| Topic | Document |
| --- | --- |
| Activation, pairing and credential rotation | [ACTIVATION.md](ACTIVATION.md) |
| Runtime architecture and state machine | [coffee-terminal/DESIGN.md](coffee-terminal/DESIGN.md) |
| Cloud and local API contract | [coffee-terminal/API.md](coffee-terminal/API.md) |
| Instance configuration reference | [config/README.md](config/README.md) |
| Release history | [CHANGELOG.md](CHANGELOG.md) |

## License

This repository is currently an internal project. Add a license before distributing it outside the project team.

## Current behavior (2026-09-17 audit)

Stock, jobs, pickup occupancy and outgoing events share SQLite. Completed cups keep the pickup slot occupied until a matching local confirmation; remote interrupted tasks require on-site review. Historical recipe versions can be loaded from recipe-archive when validated. Customer cloud pages default to an available 3D view, whereas the terminal opens 3D on demand.

See [the complete index](docs/README.md) for recovery, customization, UR arms, sound, content packages, Windows packaging and the documentation audit. Dated test counts describe their original releases, not a new run.
