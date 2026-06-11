---
"@shopify/shop-cli": minor
---

Identify the CLI as the caller on outbound MCP requests via an `X-Shopify-Agent-Source: shop-cli` header.

- Sent on every Global Catalog and per-shop UCP MCP request from a single chokepoint (`callMcp`), so it covers authenticated and unauthenticated catalog calls alike.
- Lets Shopify attribute Shop CLI traffic server-side — closing the gap where unauthenticated global-catalog searches otherwise collapse into one anonymous bucket.
- The value is self-asserted analytics/funnel metadata only; it is spoofable and must never be used for trust, fraud, or rate-limiting decisions.
