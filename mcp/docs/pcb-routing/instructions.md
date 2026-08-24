# PCB layer count, rules, copper, and routing

Use `run_pcb_router_dsl` after opening the exact target EasyEDA PCB. The tool reports the authoritative installed `eda-copilot-router/docs/routing-dsl.d.ts` path; read it before writing DSL and do not invent helpers or example directories.

This workflow can run independently of placement.

## Default: one complete transaction

For new or full-board routing, write one DSL file and call the tool once. Put all known intent before one terminal:

- copper-layer structure;
- fabrication and DRC limits;
- power-net currents;
- controlled impedance and length/skew requirements when verified physical data exists;
- planes, polygons, fanout, and required via stitching;
- routing scope and an optional quality policy.

Normally end a full transaction with `runAll()`. Do not route net groups in separate calls merely to create stages. Earlier committed copper becomes an obstacle and can block a better dense-board solution; the router already performs internal stages.

Multiple transactions are allowed for a user-requested partial operation, an isolated rules/copper task, or a focused repair after checking a full attempt. They are usually less efficient. Use `onlyNets(...)` for selected routing and clear only the copper that must be replaced.

## Describe electrical intent

Let the router derive geometry from the effective rules and declared physical assumptions:

- Use `powerNet("VBUS", { maxCurrentA: 2 })` instead of calculating track width. Add temperature rise, power pads, or tap constraints only when known.
- Use semantic impedance in `signalNet` or `diffPair` only with verified stack/reference information.
- Use `matchedGroup`, differential skew limits, `plane`, `polygon`, `fanout`, and the appropriate `viaStitch` mode when required.
- Use `drc(...)` and `netClass(...)` for real fabrication limits, not guessed geometry.

Do not manually calculate track width, via diameter/drill, or impedance geometry when semantic intent can derive it. Use explicit geometry only when the user, fabricator, pad geometry, or a verified requirement provides it.

## Copper layers and physical assumptions

For a new or full routing transaction, normally declare the intended copper-layer structure with `stack(...)`:

```js
stack({
  layers: [
    { kind: "copper", name: "TOP" },
    { kind: "copper", name: "INNER_1" },
    { kind: "copper", name: "INNER_2" },
    { kind: "copper", name: "BOTTOM" },
  ],
});
```

EasyEDA accepts an even copper-layer count from 2 to 32. The routing transaction applies this count before validating routed layers. EasyEDA does not persist dielectric thickness, material, permittivity, copper thickness, or other full physical stack properties; it returns `EASYEDA_STACKUP_LAYER_COUNT_ONLY` when only the layer count is applied.

Dielectric details are not required for ordinary routing. If verified physical data is supplied for current or impedance calculation, it may be declared for the router, but report that only the copper-layer count is written to EasyEDA. Never invent physical stack values. If controlled impedance is required and physical data is unavailable, ask for a fabricator stack rather than claiming verified impedance.

## Preserve and clear

Existing tracks, vias, and zones are fixed obstacles and are preserved by default. To replace existing copper, declare the exact scope in the same DSL:

```js
clearRouting({ nets: ["USB_D+", "USB_D-"], items: ["tracks", "vias"] });
```

Do not add `clearRouting({ nets: "all" })` by habit. A separate clear tool is not part of this workflow.

## Quality policy

Normally omit `quality(...)`; the router defaults to `balanced`. If the profile must be explicit, prefer `quality({ profile: "balanced" })`. Omit `maxCandidates` unless a measured routing problem justifies a bounded retry. Do not use `completion-first` or `maxCandidates: 16` as a default template.

## Select one terminal

End every DSL file with exactly one terminal:

- `applyDrcRules()` for rules only;
- `applyStackup()` for copper-layer count only;
- `runCopper()` for selected polygons, planes, or stitching without KRT routing;
- `runRouting()` for routing without applying DSL DRC changes;
- `runAll()` for full rules, layer count, copper, and routing intent.

## Run and verify

1. Open the target PCB and call `get_pcb_stack_layers` when current layers affect the decision.
2. Inspect only the nets, components, or PCB data needed to write correct intent.
3. Write one complete DSL transaction and call `run_pcb_router_dsl({ file })`.
4. If it returns `status: "running"`, call `wait_operation({ operation_id })` until terminal.
5. Review diagnostics, metrics, apply result, and `native_verification`.
6. Use `inspect_net` for a reported or critical net. Render a focused `preview_pcb` only when visual copper evidence helps.
7. Do not repeat native DRC immediately unless the router result is incomplete or the board changed afterward.
8. If unresolved violations remain, stop and ask the user whether to keep, fix, or restore the result.

The routing apply step uses one EasyEDA checkpoint recovery boundary and restores automatically on an application exception. A successfully applied result with DRC violations remains applied. EasyEDA currently applies through vias and copper zones without holes.
