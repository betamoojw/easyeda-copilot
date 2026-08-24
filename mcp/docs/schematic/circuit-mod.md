# Circuit modification rules

## Component search

Prefer the exact manufacturer MPN. A descriptive query such as `1k 1% 0805 resistor` may be used only to discover candidates when an exact MPN is not yet known. Select a real returned component and keep its exact `part_uuid` and manufacturer MPN.

Never invent an MPN or UUID. Confirm package, electrical ratings, tolerance, and relevant limits before selecting among candidates. Every added component requires a real non-null `part_uuid`.

## Functional blocks

Group components by a completed function and local signal path, not by component type.

- Keep an op-amp, transistor, regulator, or main IC with the input, feedback, gain, bias, compensation, and local filtering parts that make its stage work.
- Do not split one amplifier into separate `OpAmp` and `Resistors` blocks.
- A one- or two-component block is appropriate only for a self-contained function or endpoint, such as a connector, fuse, or LED with its resistor.
- If extraction produced fragmented block names, correct them in one final beautify call.

## Extraction

`extract_circuit_on_current_page` can add and remove components and change external connections on the opened page.

- Replace a component by removing it and adding the replacement with the same base designator.
- Use identical `signal_name` values for pins on the same net.
- Leave a signal empty only when the pin should remain unconnected; use `NC` for an intentional no-connect.
- Do not add unrelated protection, filtering, or future signals unless requested or required by the selected proven block.
- Combine known related changes, but do not force unrelated or risky work into one call merely to reduce tool count.

## Reused blocks

Search by function, inspect returned parameters and ports, and use the exact block UUID. Map every exposed port to an intentional signal name. A close but unsuitable reused block is not preferred over a correct explicit circuit.
