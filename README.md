# GridShift

**Shift AI workloads to reduce peak power demand.**

GridShift is a grid-responsive control layer for AI data centers. When the grid is stressed, it finds the AI workloads that can safely move in time, plans the least-disruptive change, executes it through the data center's scheduler after operator approval, and **verifies the megawatts actually moved**.

Built for the **Microsoft + CCI Innovation Challenge for Virginia** (September 2026) using **Microsoft Foundry**.

---

## The problem

AI growth means more compute, more data centers, and more electricity demand. Northern Virginia is already the largest data center market in the world, and Virginia's JLARC found data centers are the primary driver of the state's forecast electricity-demand growth. JLARC modeled that a typical Dominion residential customer could see an extra **$14 to $37 per month** in generation- and transmission-related cost by 2040.

Grid planners size the system for peak hours, and today they must treat data center load as rigid. But a large share of AI compute is **not** rigid. A training run with checkpoints, a nightly evaluation suite, or a batch embedding job can pause, throttle, or shift without hurting any end user. Only customer-facing inference truly needs every megawatt every second.

GridShift makes that flexibility operational, measurable, and safe.

> Keep the AI growth. Make the flexible part of its demand actually flexible.

## What it does

One engine, two surfaces:

| Surface | Question it answers | User |
|---|---|---|
| **Policy Lab** | *Would this demand-flexibility rule work against real workloads?* | Policy / utility program analyst |
| **Live Ops** | *Can we execute the active rule right now, and prove what happened?* | Data center / AI infrastructure operator |

Both surfaces share the same policy schema, workload model, optimizer, action vocabulary, and verification model.

### The core loop

```
Rule -> observe -> plan -> approve -> act -> measure -> verify -> restore
```

1. A grid event arrives: *"reduce 10% for 2 hours."*
2. GridShift snapshots current workloads and power telemetry.
3. A deterministic optimizer builds the least-disruptive plan that meets the target. Protected workloads are a hard gate and can never be selected.
4. The operator reviews exactly what will change and approves.
5. Actions execute through a scheduler adapter (mock adapter for the demo; Kubernetes Job suspend/resume is the first real actuator).
6. Power telemetry is measured continuously. **Expected** and **measured** reduction are always separate numbers.
7. If the target is missed, GridShift computes the shortfall and proposes a follow-up action. It never claims success from API calls alone.
8. When the event ends, workloads are restored in stages to avoid a rebound peak, and an auditable verification record is produced.

### Where Microsoft Foundry fits

Foundry is used for **structured policy interpretation**. An analyst pastes plain-language program text such as:

> During declared grid stress events, participating large-load customers should reduce non-critical electricity demand by 15% for up to two hours while protecting critical customer-facing services.

Foundry **Structured Outputs** with a strict JSON Schema extract the reduction target, duration, trigger, protected and flexible workload classes, and an explicit list of ambiguities the text did not specify. A human must confirm every field before the rule can be simulated, and only externally approved, versioned rules can drive Live Ops.

Foundry never sends an infrastructure command and never receives infrastructure credentials. The actuation loop is deterministic code.

## Demo scenario

Modeled site: **Virginia AI Campus, 12.6 MW**

| Workload | Power | Protected | Flexibility |
|---|---:|---|---|
| Production inference | 3.2 MW | Yes | none |
| Model training | 4.5 MW | No | throttle / checkpoint-pause |
| Embeddings | 1.4 MW | No | delay |
| Evaluations | 1.1 MW | No | suspend |
| Synthetic data | 2.4 MW | No | suspend |

Event: 10% reduction for 120 minutes, target **1.26 MW**. The optimizer touches three flexible workloads for an expected **1.71 MW**, with **zero** critical workloads affected. The live chart shows measured load falling past the target line, then a staged restore.

## Architecture

```
Browser
  |
  v
Next.js Web UI  (Live Ops, Policy Lab, Programs, Workloads, Events)
  |
  v
FastAPI control plane
  |-- Policy service ---------> Microsoft Foundry (Structured Outputs)
  |-- Workload inventory
  |-- Simulation engine
  |-- Optimizer (deterministic greedy, OR-Tools later)
  |-- Event orchestrator + state machine
  |-- Verification service (baseline vs measured)
  |-- Append-only audit log
  |
  +-- PostgreSQL / SQLite (dev)
  +-- Telemetry (simulator now; Prometheus + NVIDIA DCGM later)
  |
  v
Scheduler adapter
  |-- Mock adapter (demo)
  +-- Kubernetes adapter (Job spec.suspend)
```

### Safety invariants

- Protected workloads can never appear in an executable plan.
- AI-interpreted rules cannot be executed. Only human-confirmed, active policy versions can.
- Execution requires explicit operator approval tied to the exact plan hash and workload snapshot.
- Success requires measured telemetry, not API-call success.
- Every action is audit logged. Restoration is a first-class phase of every event.
- Read (observe) and write (actuate) permissions are separate credentials.

## Tech stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, Server-Sent Events for live updates
- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLModel
- **AI:** Microsoft Foundry model endpoint with Structured Outputs
- **Optimization:** deterministic greedy planner with hard constraint validation
- **Telemetry:** seeded simulator for the demo; designed for Prometheus + NVIDIA DCGM Exporter
- **Actuation:** mock scheduler adapter; Kubernetes Job suspend/resume adapter

## Running locally

```bash
cp .env.example .env        # add your Foundry endpoint + key

# backend
cd services/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000. The demo site and workloads are seeded automatically with a fixed random seed so the presentation is repeatable.

## Repository layout

```
gridshift/
├── apps/web/          Next.js UI
├── services/api/      FastAPI control plane, optimizer, simulator, adapters
├── docs/              architecture, demo script, policy schema
├── infra/             optional k8s demo manifests and Azure deployment
└── scripts/           seed and demo helpers
```

## Why this is feasible

Every building block already exists. Kubernetes can suspend Jobs. NVIDIA DCGM exposes GPU power in Prometheus format. PJM already compensates qualified demand response through Curtailment Service Providers. Dominion Energy is developing a Large Load Demand Flexibility Program under 2026 Virginia legislation, with an SCC filing planned for January 2027. Foundry can turn program text into a strict schema.

GridShift connects those pieces into one safe, workload-aware, verifiable control loop.

## Impact framing

GridShift does not claim to eliminate grid buildout. It targets one controllable contributor to future grid cost: avoidable peak demand from flexible AI workloads. Every verified megawatt that can move during a constrained period is capacity the grid no longer has to treat as completely rigid.

## Sources

- Virginia JLARC, *Data Centers in Virginia* (2024): https://jlarc.virginia.gov/landing-2024-data-centers-in-virginia.asp
- Dominion Energy, Demand Flexibility: https://www.dominionenergy.com/about/delivering-energy/demand-flexibility
- PJM, Demand Response and Curtailment Service Providers: https://www.pjm.com/markets-and-operations/demand-response.aspx
- Microsoft Foundry, Structured Outputs: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs
- NVIDIA DCGM Exporter metrics: https://docs.nvidia.com/datacenter/dcgm/latest/reference/dcgm-exporter-metrics.html
- Kubernetes Jobs (suspend): https://kubernetes.io/docs/concepts/workloads/controllers/job/
