# Verification

Use only the checks relevant to the requested stage. A successful generator response is not sufficient evidence by itself.

## Schematic

- Re-read the affected page with `get_current_page_schematic` when exact component or net confirmation is needed.
- Confirm intended components, pins, signal names, and functional page ownership.
- Confirm that every component supplied to beautify appears in exactly one block.

## Placement and mechanics

- Treat the solver report and `previewSvgPath` as pre-assembly evidence.
- After assembly, use `inspect_component` for affected components.
- Use `preview_pcb` for connectors, mechanics, suspicious overlap, or a requested visual check; do not render every ordinary edit.
- On an already routed PCB, run `check_pcb_drc` after moving or adding components because the placement solver does not model all existing copper and board objects.

## Copper and routing

- Review router diagnostics, metrics, apply result, and `native_verification`.
- Use `inspect_net` for a reported or critical net instead of inspecting every net.
- Do not immediately repeat `check_pcb_drc` when the router already returned current native DRC. Repeat it after later editor changes or when the returned result is incomplete.
- A DRC finding does not authorize automatic rollback. Ask the user to keep, fix, or restore the result.

## Result classes

```text
PASS: requested evidence is present and no blocking issue remains
WARN: known limitation or accepted risk; state the reason
FAIL: a requested requirement or applied design check is not satisfied
```
