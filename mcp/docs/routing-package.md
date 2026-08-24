# eda-copilot-router integration

EasyEDA Copilot consumes `eda-copilot-router@0.2.1` through the same public
contract as KiCad Copilot. The router package owns the DSL, EDA-neutral board
model, polygon planning, KRT backend, managed backend assets, and diagnostics.
EasyEDA-specific document objects remain in the host adapter.

One PCB DSL operation has these boundaries:

1. Compile the local DSL and identify any explicit `clearRouting(...)` intent.
2. Capture EasyEDA autoroute input and native DRC once.
3. Import preserved copper as fixed and only explicitly cleared copper as
   editable.
4. Run `eda-copilot-router` and KRT completely offline with an `AbortSignal`.
5. Validate the complete result before changing the editor.
6. Apply requested DRC, selective deletion, new copper, refill, and native DRC
   inside one EasyEDA checkpoint recovery boundary.

The MCP entry point is `run_pcb_router_dsl`. A still-running call returns a
prefixed `operation_id`; continue it with the shared `wait_operation` tool or
stop it with `cancel_operation`.

Existing copper is preserved unless the DSL explicitly calls
`clearRouting(...)`. Physical `applyStackup()` is rejected because the current
EasyEDA extension API does not expose a lossless physical stackup writer.
Tracks and zones support every active EasyEDA copper layer. Only through vias
and zone outlines without holes can currently be applied.
