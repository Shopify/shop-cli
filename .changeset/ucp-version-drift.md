---
"@shopify/shop-cli": minor
---

Detect UCP version drift so agents on a stale install learn to update instead of hitting opaque errors:

- `shop --version` now prints the UCP release the CLI speaks alongside the package version, e.g. `0.1.2 (UCP 2026-08-25)`.
- New `shop version [--check] [--shop-domain <domain>]` command prints `{ cli, ucp }` and, with `--check`, fetches the global catalog's (or a merchant's) `/.well-known/ucp` manifest and reports whether the pinned release is `current`, `outdated`, `unsupported`, `ahead`, or `unknown`, with an update hint.
- MCP JSON-RPC errors now include the server's `message`/`data` (e.g. `Tool not found: search_catalog`), and a "Tool not found" error is checked against the host's manifest and explained as a dropped UCP release with the upgrade command.
- When a server negotiates a different UCP release than the CLI requested, a one-time `# Notice` is written to stderr; stdout stays clean JSON/markdown.
