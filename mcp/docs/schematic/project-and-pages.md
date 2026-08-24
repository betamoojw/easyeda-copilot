# Projects and schematic pages

EasyEDA tools act on a connected project and the currently opened document.

## Functional pages

New or substantially expanded schematics must be divided into functional pages such as `Power`, `MCU`, `USB`, `Sensors`, or `MotorDriver`.

- Keep one coherent subsystem on each page.
- Keep an IC with its local decoupling and closely related support components.
- Split a page when it contains independent functions or is no longer easy to understand.
- Do not create one page per small IC or passive network.
- Use stable, explicit signal names across pages. Do not add unused future signals.
- Do not silently reorganize a user's existing schematic during a small unrelated edit.

## Tools

1. Call `get_current_project_info` once to find the schematic and page UUIDs.
2. Use `create_doc({ doc: { doc_type: "schematic" } })` only when a schematic does not exist.
3. Use `create_doc({ doc: { doc_type: "schematic_page", schematic_uuid } })` for each additional functional page.
4. Give each page a short functional name with `modify_name`.
5. Call `open_document` with the target page UUID before reading or modifying it.

`delete_doc` is destructive. Use it only when deletion is explicitly requested and the exact target was verified.
