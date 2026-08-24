# Mechanical validation

Read this file when placement changes the outline, holes, connectors, switches, buttons, displays, LEDs, antennas, card slots, or other enclosure-facing parts.

## Inventory

For each affected mechanical component identify:

- designator and footprint;
- intended PCB side and accessible edge;
- direction of the mating face, opening, actuator, light, or display;
- whether the body remains inside, stays near the edge, overhangs, or has an exact location;
- required plug, cable, card, antenna, enclosure, and mounting clearance.

Do not assume every connector belongs on an edge. Vertical headers, internal FFC, board-to-board connectors, and test connectors may belong inside the board.

## Choose the primitive

- Prefer `edgePlace` for a connector or control that remains inside near an edge. It can slide to a valid nearby position around other components.
- Use `edgeMount` when the component belongs on an edge and its real footprint geometry determines center, facing, and overflow. USB, AUX, RJ45, barrel jacks, and side-entry card slots commonly need it.
- Use `fixed` only when an enclosure or mechanical drawing specifies an exact coordinate.
- Use `face: "outward"` for directional external interfaces. If automatic face detection is wrong or uncertain, declare `faceAt0(...)` first.

There is no universal inset or overhang. Derive it from the footprint, mating opening, neighboring components, and enclosure access. Around `0.5 mm` is only a common inside-edge recommendation; compact boards may need less.

For an overhanging connector:

1. expose the complete mating opening;
2. keep electrical pads and required retention tabs supported by the PCB;
3. avoid unnecessary protrusion;
4. ask the user for the required protrusion when enclosure geometry is important and unknown.

## Access and keepouts

Use the smallest justified placement keepout. A local mechanical keepout is normally below `10 mm`; do not create a blanket `20 mm` region without a verified requirement.

`constraintRegion` protects placement only. It does not create a copper keepout.

Check plug insertion, cable bend, card travel, finger access, switch movement, display visibility, antenna clearance, mounting hardware, and collisions between adjacent connectors.

## LLM gate

Inspect the focused solver preview before asking for approval:

```text
[ ] correct edge and top/bottom side
[ ] opening, actuator, LED, or display faces the intended direction
[ ] an external directional connector does not face into the board
[ ] inset or overhang matches the footprint
[ ] pads and retention features remain supported
[ ] plug, cable, card, and fingers have access
[ ] nearby mechanical components do not block each other
[ ] holes, enclosure areas, and antenna regions are clear
[ ] alignment and rotation look intentional
```

Fix an obvious in-scope error before presenting the preview. If a critical dimension or direction is unknown, ask one focused question rather than guessing.

After assembly, use `inspect_component` and a focused `preview_pcb` when the live board must be checked against preserved copper or objects. Ask the user before restoring a checkpoint.
