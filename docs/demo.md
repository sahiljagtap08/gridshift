# Demo script (target: under 4 minutes on the product)

0. Open https://gridshift.azurewebsites.net. Let the landing scene orbit for a beat, click **Get started**.
1. Open Live Ops. Point at **12.6 MW** current demand and the 3D facility: hover the inference racks (PROTECTED) and the training racks.
2. Show the workload table. Production inference is badged **PROTECTED**.
3. Click **Simulate grid event**: 10% for 120 min, 10 min response.
4. Plan appears: expected **1.50 MW** (training -10%, eval suspended), critical workloads affected **0**. Point out embeddings excluded for its deadline.
5. Click **Approve & execute**.
6. Watch the two workloads change state in the table, the training racks turn yellow and the eval racks go dark in the 3D view, and the chart fall through the target line.
7. Status flips to **TARGET MET**. Open the verification record.
8. (Optional) Toggle **Simulate under-delivery**, re-run, show the shortfall replan.
9. Switch to Policy Lab. Paste the rule text, click **Interpret rule**, show Foundry's structured fields and ambiguities, confirm, run simulation, show FEASIBLE.
10. Close: same rule object powers both surfaces.
