# PCB placement

`make_pcb_layout` creates placement and mechanics only. It returns a preview and stored `layoutId`; it does not apply the result or authorize routing.

Read `dsl.ts` as the exact syntax source. The files in `examples/` are patterns, not authority. They use the same order: board and global rules, functional blocks, components and mechanics, electrical placement intent, then output and solver. Read any examples that help, but derive designators, dimensions, pin numbers, and constraints from the actual board.

## Start

1. Resolve the BOARD, linked schematic, and target PCB with `get_current_project_info`.
2. If schematic changes must be imported, call `import_pcb_changes`, then **stop and ask the user to confirm the EasyEDA import dialog**. Continue only after confirmation.
3. Open the target PCB before `make_pcb_layout`. The MCP captures its outline and linked schematic-component positions as `existingPlacement`.
4. Call `get_pcb_component_sizes` once for the required designators. Use `includeAll: true` only when sizing or validating the board genuinely requires every component; its output is much larger.
5. Select one preservation mode before writing DSL.

| Intent | DSL |
|---|---|
| New PCB or full re-placement | do not call `preserve` |
| Keep current outline; re-place components | `preserve({ board: true })` |
| Add/place new components; keep existing placement | `preserve({ board: true, components: "all" })` |
| Move selected existing components | preserve an explicit list of every component that must not move |

`components: "all"` preserves current schematic components whose centers are inside the board outline. Explicitly list an outside-board component that must stay fixed. Do not use `"all"` when an existing component must move.

Every placement DSL for an existing PCB must contain one `preserve(...)` declaration matching the selected mode. Keep it in the complete DSL used for mechanical preview, final placement, and any later placement repair. Omit it only for an intentional new-board or full re-placement result.

## Electrical and routing preflight

Placement and routing are one coupled physical problem. Do not write placement DSL until the component-to-net topology has been reviewed and there is a plausible way to route the proposed placement. Routing cannot rescue a placement that blocks its only signal, power, return, escape, or thermal paths.

1. Inspect the complete connectivity once. Reuse complete schematic context when available; otherwise use one `get_current_pcb` snapshot after import. If only pin function is ambiguous, read the relevant schematic page. Do not call `inspect_net` for every net.
2. Trace logical paths through series resistors, AC-coupling capacitors, ferrite beads, common-mode chokes, zero-ohm links, and matching networks. A net-name boundary at a series component does not end the logical signal. Continue only through its series channel; do not treat a shunt capacitor or ESD branch as path continuation.
3. Review every component and connected net. Classify mechanics, critical signal paths, power paths and current loops, thermal candidates, and ordinary connectivity. Ordinary nets need no DSL constraint, but they still count as reviewed.
4. Choose a provisional routing strategy before density: intended copper-layer roles, reference/return planes, supported via technology, dense-package escape directions, and which layers may pass under components. This is planning only; placement does not authorize changing stackup or routing.
5. Reserve continuous capacity for each important flow: both legs and every series segment of a differential pair, RF/clock paths, high-current copper, switch/decoupling loops, return paths, connector escapes, via fields, and thermal spreading. Keep critical loops short without packing them so tightly that their required copper cannot fit.
6. Then choose board size, density, component sides, rotations, blocks, and constraints. High density and `compactness: "high"` are valid for a topology and layer/via strategy that can support them; low density alone does not guarantee routability.

For each power IC, regulator, MOSFET, driver, high-power LED/resistor, and exposed pad, explicitly decide whether it needs `primitive.thermalPad(...)`, external copper/via space to be implemented during routing, or no thermal action. Base the decision on the datasheet and credible dissipation assumptions; do not silently omit the thermal review.

Use the topology analysis selectively. One critical ordered chain may justify `signalPath`; one isolated dominant hop may justify `criticalPair`. Do not convert every reviewed connection into a placement constraint.

## Run

1. Define the board, holes, blocks, components, and only preflight-justified constraints in one complete placement DSL file.
2. If mechanics changed, read `mechanical-validation.md` and run a focused mechanical preview with `solver({ preview: true, placeOnlyComponents: [...] })`.
3. Call `make_pcb_layout({ file })`. If it returns `status: "running"`, call `wait_operation({ operation_id })` until terminal.
4. Inspect `previewSvgPath` and solver diagnostics. Confirm that critical logical paths remain ordered, dense packages have escape directions, and planned signal, power, via, and thermal areas are not blocked. If a `post_place_opportunity` suggests `refineGroup`, add it only when that exact swap or rotation is allowed. A preview result is never assembled.
5. Reject a placement with no plausible route for an important path. Fix hard errors and one obvious in-scope visual problem; do not chase zero warnings.
6. Show the preview and ask for user approval.
7. Remove preview filters when full placement is requested, run the complete DSL, wait when needed, and inspect the final preview.
8. Ask for final placement approval.
9. Keep the target PCB open and call `assemble_pcb_layout_on_current_pcbdoc({ layoutId })` only with the completed final `layoutId`.
10. Run targeted live-PCB checks and stop unless routing was explicitly requested.

Assembly preserves existing copper and board objects. It replaces the existing outline only when the placement result contains a new valid outline. The solver receives existing outline and schematic-component positions, but not every copper or mechanical primitive; check an incrementally changed routed board after assembly.

## Placement structure

- Every new or movable real component belongs to exactly one explicit block. A component protected by `preserve({ components: ... })` may be omitted; the runtime gives otherwise unowned preserved components a system block.
- A block is one physical island and normally shares a non-GND net. Use `allowDisconnected: true` only for intentional mechanical or same-role groups.
- Keep blocks below 12 components. Split dense functions into local power, clock, flash, feedback, input, output, or interface islands.
- Keep an IC with the local parts that make its stage work; do not group by component type.
- Do not mix top and bottom components in one block.
- A block containing `fixed`, `edgeMount`, or `edgePlace` components must be board-level/main. It cannot use `placement: "satellite"` or `attachTo`; relate its electronics to other blocks with `near`, `veryNear`, or `criticalPair`.
- Use modules as soft macro groups; do not put distant edge connectors into one sparse module.
- Do not repeat a satellite in a module that already contains its parent block; the parent family already owns that satellite.
- Use `criticalPair` for one isolated dominant pad-to-pad hop that is not part of a longer declared path.
- Use `corePairs` for several independent dominant pairs inside one block, not for the consecutive segments of a signal chain.
- Use `signalPath` only for a physically critical ordered chain, especially RF or high-speed signals through series matching, filtering, or termination parts. It is self-contained: do not repeat its segments with `criticalPair` or `corePairs`, because overlapping attraction rules can over-constrain the placer.
- Do not use `signalPath` for ordinary control/digital nets, a single isolated hop, or every connection on the board. It guides placement only; routing and impedance intent remain separate.
- Use `capCluster` for two or more capacitors sharing supply and return; use `bypass`, `veryNear`, or `criticalPair` for a single capacitor.
- Use `fixed` only for a true mechanical coordinate.
- Use `constraintRegion` for placement exclusion; it is not a copper keepout.

Current examples:

- `examples/esp32c3-devboard.js`: edge mechanics, power clusters, both USB differential legs continued across protection and series resistors, and a diagnostic-justified refinement group.
- `examples/rf-amplifier.js`: a straight critical RF path between edge-mounted connectors and a separate power section.

Example for one critical RF chain:

```js
signalPath("RF_ANT", [
  [pin("J1", "1"), pin("L1", "1")],
  [pin("L1", "2"), pin("C1", "1")],
  [pin("C1", "2"), pin("U1", "ANT")],
]);
```

## Post-placement refinement

The solver already tries safe 180-degree rotations and swaps for eligible movable components within their block. Do not add `refineGroup` by default.

Use `refineGroup` only when a `post_place_opportunity` diagnostic suggests it, or when named equivalent fixed/preserved components are intentionally allowed to exchange their final poses or rotate 180 degrees. It is permission for a final polish, not a placement command: it creates no coordinates, does not replace blocks or constraints, and may accept no move.

```js
refineGroup("headers", ["H1", "H2"], { swap: true, rotateBy: [180] });
```

- `swap: true` requires at least two pose-compatible components: the same part, footprint, or equivalent footprint geometry.
- `rotateBy` supports only `[180]` and is relative to the resolved pose. The component must also allow that final rotation.
- Give every group a unique non-empty name. Components cannot appear in multiple refinement groups. Enable `swap`, `rotateBy`, or both.
- Listing a fixed or preserved component explicitly permits its pose to change. Do not list anything whose exact pose or designator-to-position mapping must remain fixed.
- Do not use `refineGroup` for `edgeMount`, `edgePlace`, or synthetic `boardPad` components; they are not refinable.
- A swap moves component identity and pinout to the other resolved pose. For connectors and other mechanical parts, use it only when the parts are truly interchangeable, then inspect orientation and access in the preview.
- A run that accepts no refinement move is valid. Do not keep adding constraints merely to force a move.

## Starting values

Use `board.auto(...)` unless dimensions are mechanically fixed. For an ordinary board without stronger topology evidence, useful starting values are density `0.4`, component clearance `0.25-0.5 mm`, and grid `0.5` or `1 mm`. Footprint geometry, mechanics, and routing feasibility take priority.

`clearance` includes body and silkscreen bounds and defaults to `0.35 mm`. For `capCluster`, a starting gap of `0.25-0.4 mm` is usually appropriate. Choose compactness from the topology and intended routing technology, not from a blanket preference for sparse or dense placement.

## Result handling

Warnings are review evidence, not an optimization backlog. Fix a warning when it violates a user requirement, mechanics, or a dominant electrical path. Never assemble before approval. After assembly, keep, repair, or restore based on verification; restore a clearly invalid result that cannot be repaired safely, not a warning alone.
