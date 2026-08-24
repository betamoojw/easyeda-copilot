# PCB routing workflow

Use `run_pcb_router_dsl` only after opening the target EasyEDA PCB document.
Write the routing program to a local JavaScript file using the
`eda-copilot-router` DSL, then pass its path as `file`. The authoritative DSL
declarations are shipped by that dependency at `docs/routing-dsl.d.ts` inside
the installed `eda-copilot-router` package.

1. Inspect the PCB and its active copper layers.
2. Write explicit routing, rule, polygon, plane, and via-stitching intent.
3. End the DSL with exactly one terminal operation such as `applyDrcRules()`,
   `runCopper()`, `runRouting()`, or `runAll()`.
4. Call `run_pcb_router_dsl({ file })`.
5. If it returns `status: "running"`, call
   `wait_operation({ operation_id })` until the result is terminal.
6. Use `cancel_operation({ operation_id })` only for obsolete work.
7. Review router diagnostics and `native_verification` before continuing.

Existing copper is an obstacle and is preserved by default. To replace old
routing, declare exactly what may be removed with `clearRouting(...)` in the
same DSL. Do not use a separate clear tool.

EasyEDA currently applies through vias and copper zones without holes. Physical
stackup persistence is not available, so `applyStackup()` and a routing program
that requests a changed physical stackup fail before editor mutation.
