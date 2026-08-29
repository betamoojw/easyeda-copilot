# PCB layer count, rules, copper, and routing

Use `run_pcb_router_dsl` after opening the exact target EasyEDA PCB. Read the local `dsl.ts` as the exact syntax source before writing DSL. Do not invent helpers or example directories. The path reported by the tool identifies the installed upstream copy; read it only when diagnosing a version mismatch.

This workflow can run independently of placement.

## Default: one complete transaction

For new or full-board routing, write one DSL file and call the tool once. Put all known intent before one terminal:

- copper-layer structure;
- fabrication and DRC limits;
- power-net currents;
- controlled impedance and length/skew requirements when verified physical data exists;
- planes, required polygons, and required via stitching;
- routing scope, net importance, and via preferences.

Normally end a full transaction with `runAll()`. Do not route net groups in separate calls merely to create stages. Earlier committed copper becomes an obstacle and can block a better dense-board solution; the router already performs internal stages.

Multiple transactions are allowed for a user-requested partial operation, an isolated rules/copper task, or a focused repair after checking a full attempt. They are usually less efficient. Use `onlyNets(...)` for selected routing and clear only the copper that must be replaced.

## Two-layer GND plane

For a new or fully routed ordinary two-layer board, the GND plane must cover both copper layers. Write `layers: "OUTER"` explicitly; do not rely on the omitted default.

```js
plane({
  net: "GND",
  layers: "OUTER",
  region: board(),
});
```

`OUTER` means TOP and BOTTOM. Use only `TOP` or only `BOTTOM` when the user explicitly requests it or verified board constraints reserve the other layer; state the exact reason. Do not invent a reason from component density or routing convenience. For boards with four or more layers, select reference-plane layers from the intended stack instead of applying `OUTER` or `ALL` by habit.

One `plane(...)` declaration is one logical zone, so `zones: 1` or `planeZones: 1` does not mean one physical layer. EasyEDA creates one pour on every selected layer.

## Fanout is a retry

Do not call `fanout(...)` in the first routing attempt unless the user explicitly requires it. Let normal routing escape the package first. Add fanout only when the no-fanout result shows an escape problem at a dense QFN/QFP or specific pad.

Use the smallest target: prefer `pad(...)` when only some pads fail, and use `component(...)` only when the whole dense package needs the same escape policy. Prefer `method: "auto"`; request `underpad` directly only with a clear reason. A successful fanout is committed before main routing and can consume useful routing corridors.

## Describe electrical intent

Let the router derive geometry from the effective rules and declared physical assumptions:

- Use `powerNet("VBUS", { maxCurrentA: 2 })` instead of calculating track width. Add temperature rise, power pads, or tap constraints only when known.
- Use `priority: "critical"` only for nets whose failure or late routing can damage the design, such as verified oscillator, clock, reset, or sensitive feedback nets. Use `high` for important head-start routing and leave ordinary nets at `normal`.
- Use `viaPreference: "avoid"` for short or sensitive nets where a planar route is strongly preferred. `forbid` is a prohibitive routing preference, not a replacement for a fabrication/DRC rule.
- Use semantic impedance in `signalNet` or `diffPair` only with verified stack/reference information.
- Use `matchedGroup`, differential skew limits, `plane`, `polygon`, and the appropriate `viaStitch` mode when required.
- Use `drc(...)` and `netClass(...)` for real fabrication limits, not guessed geometry.

Do not manually calculate track width, via diameter/drill, or impedance geometry when semantic intent can derive it. Use explicit geometry only when the user, fabricator, pad geometry, or a verified requirement provides it.

## Existing DRC relations

Before changing existing net-class, differential-pair, or matched-length membership, call `get_pcb_drc_rules` once. It returns the compact authoritative relation state.

- `netClass`, `diffPair`, and `matchedGroup` upsert complete definitions and may replace membership.
- Use `assignNetsToNetClass`, `removeNetsFromNetClass`, or `unassignNetClass` for a targeted class edit.
- Use `addNetsToMatchedGroup`, `removeNetsFromMatchedGroup`, or `moveNetsToMatchedGroup` for a targeted matched-group edit.
- Use `deleteNetClass`, `deleteDiffPair`, or `deleteMatchedGroup` only when deletion is intended.

Do not reconstruct unrelated relations from memory or from a large PCB dump.

## Copper layers and physical assumptions

For a new or full routing transaction, declare the intended copper-layer structure with `stack(...)`. Resolve missing physical values instead of silently dropping stack-dependent intent:

1. Use the user's or fabricator's verified stack when available.
2. For an ordinary non-impedance prototype with no contrary evidence, a provisional `1.6 mm` FR-4 board and `1 oz` copper is a reasonable assumption. Declare it and report it to the user.
3. Ask for the fabricator stack when controlled impedance, flex construction, unusual thickness, inner-layer current capacity, or another requirement depends on dielectric or copper geometry.
4. Never omit `powerNet`, impedance, or another requested semantic method merely because stack data is missing. Either state a provisional stack or ask for the missing data.

Ordinary two-layer provisional example:

```js
stack({
  boardThicknessMm: 1.6,
  fallbackCopperThicknessOz: 1,
  layers: [
    { kind: "copper", name: "TOP" },
    { kind: "copper", name: "BOTTOM" },
  ],
});
```

EasyEDA accepts an even copper-layer count from 2 to 32. The routing transaction applies this count before validating routed layers. EasyEDA does not persist dielectric thickness, material, permittivity, copper thickness, or other full physical stack properties; it returns `EASYEDA_STACKUP_LAYER_COUNT_ONLY` when only the layer count is applied.

`fallbackCopperThicknessOz` is used for current-derived `powerNet` width when a layer has no explicit copper thickness. Impedance calculation requires usable copper and dielectric geometry, permittivity, and a reference plane; a board-thickness number alone is not enough. Report all provisional values and that only the copper-layer count is written to EasyEDA.

## Preserve and clear

Existing tracks, vias, and zones are fixed obstacles and are preserved by default. To replace existing copper, declare the exact scope in the same DSL:

```js
clearRouting({ nets: ["USB_D+", "USB_D-"], items: ["tracks", "vias"] });
```

Do not add `clearRouting({ nets: "all" })` by habit. A separate clear tool is not part of this workflow.

## Routing policy

There is one internally managed native KRT policy. Do not emit `quality(...)`, profile names, candidate counts, `maxVias`, or `paddingMm`; these are not part of the routing DSL. The router owns staged routing, bounded repairs, blocker recovery, and candidate grading.

`priority` and `viaPreference` express board intent rather than selecting an engine profile. Successfully verified critical and special copper is protected from later stages. Short critical/avoid nets with unnecessary vias are eligible for a bounded planar reroute.

## Select one terminal

End every DSL file with exactly one terminal:

- `applyDrcRules()` for rules only;
- `applyStackup()` for copper-layer count only;
- `runCopper()` for selected polygons, planes, or stitching without KRT routing. `along` can follow retained existing tracks and `return` can use retained existing signal vias; if the required source routing does not exist, use `runRouting()` or `runAll()`;
- `runRouting()` for routing without applying DSL DRC changes;
- `runAll()` for full rules, layer count, copper, and routing intent.

## Run and verify

1. Open the target PCB and call `get_pcb_stack_layers` when current layers affect the decision.
2. Inspect only the nets, components, or PCB data needed to write correct intent.
3. Write one complete DSL transaction and call `run_pcb_router_dsl({ file })`.
4. If it returns `status: "running"`, call `wait_operation({ operation_id })` until terminal.
5. Review status, diagnostics, metrics, apply result, and `native_verification`. A useful `partial` result is intentionally applied; incompleteness alone is not a reason to restore it.
6. Use `inspect_net` for a reported or critical net. Render a focused `preview_pcb` only when visual copper evidence helps.
7. Do not repeat native DRC immediately unless the router result is incomplete or the board changed afterward.
8. If a successfully applied result has one clear local tool-generated violation, diagnose it and use one focused follow-up DSL repair without restoring the checkpoint. Recheck the changed result.
9. If violations remain, decide whether to keep, repair, or restore. Keep only a non-blocking accepted condition; repair when the scope is safe and local; restore when the result clearly violates requirements, causes a broad regression, or safe repair would overwrite substantial user copper. Ask the user only when the acceptance requirement itself is unknown.
10. After repair or restore, repeat current analysis and DRC, then report the decision and evidence.

The routing apply step uses one EasyEDA checkpoint recovery boundary and restores automatically on an application exception. A useful incomplete result remains applied, as does a successfully applied result with non-catastrophic DRC diagnostics, until the agent chooses to keep, repair, or restore it after verification. EasyEDA currently applies through vias and copper zones without holes.
