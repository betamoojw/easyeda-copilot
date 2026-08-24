# Schematic workflow

Use this workflow without continuing to PCB work unless the user explicitly asks for it.

## Create or modify

1. Resolve the target schematic and functional page.
2. Open that page and read it with `get_current_page_schematic`.
3. Search only unknown parts. Prefer a suitable proven reused block for a standard function.
4. Apply related changes with `extract_circuit_on_current_page`. Prefer one coherent call per page; multiple calls are allowed when staged checking is safer.
5. Run `beautify_schematic_on_current_page`:
   - required after removal, replacement, or connection reassignment;
   - recommended after completing a new AI-generated page;
   - requires every component on the current page, grouped exactly once.
6. Re-read the page only when exact connectivity readback is needed.
7. Report the affected page and stop at the schematic boundary.

Beautify creates a checkpoint and restores it automatically if destructive page replacement fails. A successful beautify still changes the visual placement of the entire page. Warn the user first when preserving a manually arranged page matters.

## Beautify only

1. Read the current page.
2. Group all components by completed electrical function.
3. Call beautify once.
4. Check current-page readback.
5. If the user dislikes the layout, offer to keep, revise, or restore it; never restore automatically.
