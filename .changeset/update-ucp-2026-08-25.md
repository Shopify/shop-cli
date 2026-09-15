---
"@shopify/shop-cli": minor
---

Speak the UCP 2026-08-25 release instead of 2026-04-08. The agent profiles sent with every MCP call (`valid-with-capabilities` for the global catalog, `personal_agent` for merchant checkout) now point at the 2026-08-25 fixtures, matching the version Shopify storefronts advertise as their default. The release is pinned in one place (`UCP_VERSION`), and the skill reference docs use the new profile URLs.
