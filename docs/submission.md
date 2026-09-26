# Innovation Studio submission

**Entry page:** https://innovationstudio.microsoft.com/hackathons/Microsoft-and-CCI-Innovation-Challenge-for-VA/project/126240

**Executive Challenge:** Policy and Public Sentiment Analyst

**Repository:** https://github.com/sahiljagtap08/gridshift

**Live demo:** https://gridshift.azurewebsites.net

## Short description (paste into the entry)

GridShift is a grid-responsive control layer for AI data centers. Virginia's data center growth is the main driver of the state's forecast electricity demand, and grid planners must size for peak hours as if every megawatt were rigid. A large share of AI compute is not: training with checkpoints, evaluation suites, embeddings, and synthetic-data jobs can pause, throttle, or shift in time without affecting any end user.

GridShift makes that flexibility operational and measurable. Policy Lab takes a proposed demand-flexibility rule in plain language and uses Microsoft Foundry Structured Outputs to extract a strict, machine-checkable constraint set, reporting every ambiguity instead of inventing values. An analyst confirms each field, then tests the rule against a modeled data center to see whether it is feasible, which workloads would move, how many megawatts it frees, and what would make it fail. Live Ops takes the same approved rule and runs the closed loop for a real grid event: snapshot the baseline, build the least-disruptive plan with protected workloads as a hard gate, get operator approval bound to the exact plan, execute through the scheduler, measure the actual reduction from telemetry, replan any shortfall, and restore in stages. Every step is audit logged, and expected and measured megawatts are never the same number.

The result is a policy tool that does not just explain a rule but tests and executes it, producing verified, versioned evidence for the demand-flexibility programs Dominion and the SCC are designing now.

## Components

- Next.js web app: landing, Overview, Live Ops with an interactive 3D facility view, Policy Lab, Programs registry, Workloads, Events
- FastAPI control plane: Foundry policy parser, deterministic optimizer, event orchestrator and state machine, verification, audit log, SSE
- Microsoft Foundry: gpt-4.1-mini deployment with Structured Outputs, evaluated on a 10-example labelled policy set (10/10)
- Azure: App Service front door, Container Apps, Container Registry
