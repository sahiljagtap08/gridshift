# GridShift – agent notes

Implementation brief: `../GridShift_Product_Technical_Blueprint.md` (outside this repo, private).
Read the relevant section before building a component. Section 36 lists the non-negotiable invariants.

Rules for this repo:
- Small, focused commits. No Co-Authored-By or "generated with" trailers, ever.
- Build order: Live Ops vertical slice (seed -> event -> plan -> approve -> execute -> SSE -> verify -> restore) before Policy Lab.
- Foundry is used only for structured policy extraction. Never in the actuation loop.
- Protected workloads are a hard gate in deterministic code.
- Expected MW and measured MW are always separate fields.
- Demo must be deterministic: seed 42, site 12.6 MW, 10% event = 1.26 MW target.
