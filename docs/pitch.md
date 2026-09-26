# GridShift pitch deck outline

Twelve slides, about three minutes of talk before the live demo. Speaker notes are under each slide.

---

## 1. Title

**GridShift**
Shift AI workloads to reduce peak power demand.

Microsoft + CCI Innovation Challenge for Virginia · September 2026

> One line: GridShift turns the flexible part of AI data center demand into a controllable, verifiable grid resource.

## 2. The chain that raises everyone's bill

AI boom → more compute → more data centers → more electricity → higher peaks → more generation and transmission → higher system cost.

Virginia facts (JLARC 2024):
- Northern Virginia is the largest data center market in the world.
- Data centers are the primary driver of Virginia's forecast demand growth.
- A typical Dominion residential customer could pay **$14 to $37 more per month** by 2040.

> Grid planners size for the peak hour and today they must treat data center load as rigid.

## 3. The hidden assumption

"Every megawatt a data center requests must be available every second."

True for customer-facing inference. Not true for training with checkpoints, nightly evaluation, batch embeddings, synthetic data.

> The question is not "can AI use less power forever." It is "when the grid is stressed, which AI workloads can safely move, by how much, for how long, and can we prove it."

## 4. What GridShift does

One engine, two surfaces.

| Policy Lab | Live Ops |
|---|---|
| Would this rule work? | Can we execute it now, and prove what happened? |
| Policy analyst | Data center operator |

Both share the same policy schema, workload model, optimizer, and verification model.

## 5. The core loop

Rule → observe → plan → approve → act → measure → verify → restore

> This is a control loop, not a chatbot. Every step leaves an audit record.

## 6. Where Microsoft Foundry fits

Foundry Structured Outputs turns plain-language program text into a strict `PolicyRule` JSON schema: target, duration, trigger, protected and flexible classes, allowed actions, and an explicit list of ambiguities.

- A human confirms every field before anything runs.
- Only externally approved, versioned rules can drive Live Ops.
- Foundry never sends an infrastructure command and never sees credentials.

> Eval set of 10 hand-labelled policy texts: 10/10 with gpt-4.1-mini, including reporting ambiguity instead of inventing values.

## 7. Architecture

Next.js UI → FastAPI control plane → { Foundry policy parser, deterministic optimizer, event orchestrator, verification, audit log } → scheduler adapter (mock today, Kubernetes Job suspend next) ← telemetry (simulator today, Prometheus + NVIDIA DCGM next).

## 8. Safety by construction

- Protected workloads are a hard gate in code. The optimizer cannot pick them, the adapter refuses them.
- Approval is bound to the exact plan hash and workload snapshot. If anything changes, the plan is rebuilt.
- Success requires measured telemetry. Scheduler API success is never "target met."
- Expected MW and measured MW are separate fields everywhere.
- Restoration is staged to avoid a rebound peak.

## 9. Live demo (switch to the app)

Virginia AI Campus, 12.6 MW. Grid event: 10% for 2 hours = 1.26 MW.

Show: plan (training -10%, eval suspended, embeddings excluded for its deadline, inference untouched) → approve → chart falls → shortfall → replan the gap → target met → verification record → staged restore.

Then Policy Lab: paste the 15% / 2 hour rule, Foundry extracts it, confirm, simulate, FEASIBLE with sensitivity and "what would make this fail."

## 10. Impact, stated honestly

- We do not claim to eliminate grid buildout.
- We target one controllable contributor to future grid cost: avoidable peak demand from flexible AI workloads.
- Every verified megawatt that can move is capacity the grid no longer has to treat as rigid.
- PJM already pays for demand response and estimates it saves $265M to $355M per year across its footprint. Dominion is designing a Large Load Demand Flexibility Program now, with an SCC filing planned for January 2027.

## 11. Feasibility

Every building block exists today: Kubernetes Job suspend, NVIDIA DCGM power telemetry, Prometheus, PJM Curtailment Service Providers, Dominion's flexibility program, Foundry Structured Outputs. GridShift connects them into one safe, workload-aware, verifiable loop.

Path: V2 read-only Kubernetes and DCGM, shadow mode → V3 facility meter, CSP event API, program-valid baseline, OR-Tools → V4 multi-site.

## 12. Key learnings

- Keep the LLM out of the actuation loop. Extraction with a strict schema plus human confirmation is where it earns trust.
- Verification needs a baseline and a measurement, not an API response.
- The most convincing demo moment is the failure path: under-delivery, honest shortfall, replan, verified recovery.
- Deterministic seeds make a live demo repeatable.

---

## Judging criteria map

| Criterion (25% each) | Where it lands |
|---|---|
| Solution performance | Slide 9 demo: target 1.26 MW, measured above target, 0 critical workloads touched, verified record |
| Innovation | Slides 4 to 6: policy becomes an executable, versioned constraint system tied to real scheduling and verification |
| Economic value and societal impact | Slides 2 and 10 |
| Feasibility | Slides 7, 8, 11 |
