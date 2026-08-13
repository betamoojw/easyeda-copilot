# Local routing package integration

The EasyEDA host is intentionally a thin boundary around
`@easyeda-copilot/router`:

1. `export-routing-input` captures the autorouter board and native DRC once.
2. `runRoutingOnCurrentEasyEdaPcb()` converts that capture to `RoutingBoard`
   and runs the DSL and backend locally. The router package does not call
   EasyEDA while it is working.
3. `apply-routing-result` applies the effective DRC and the complete
   `RoutingResult.copper` state in one checkpointed transaction. Any failure
   restores the document checkpoint.

The package is consumed through the local file dependency in `mcp/package.json`.
The host entry point is built as:

```text
mcp/dist/routing/run-easyeda-routing.js
```

Use `apply: false` to inspect a result without mutating the open document.
Live application currently supports the top and bottom copper layers and
rejects zone holes instead of applying a lossy result.
