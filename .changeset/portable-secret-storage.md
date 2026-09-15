---
"@shopify/shop-cli": minor
---

Drop the native `keytar` dependency in favour of a portable secret store, and ship Shop skill 1.1.0.

**Portable secret storage.** `KeytarSecretStore` is replaced by `PortableSecretStore`, which has no native dependencies (the only runtime dependency is now `commander`). This lets the CLI install in sandboxed agent environments where the `keytar` native build fails. Backend resolution order:

1. `SHOP_CLI_SECRET_BACKEND` env override (`keychain` | `secret-tool` | `file`)
2. macOS → Keychain via the `security` CLI
3. Linux with a working secret service → `secret-tool`
4. Otherwise → a `0600` JSON file at `SHOP_CLI_SECRETS_PATH` or `~/.shop-cli/secrets.json` (with a one-time stderr notice when reached implicitly)

The file backend serialises operations so concurrent writes (e.g. `shop auth logout`) cannot race or lose updates. Existing macOS users keep their Keychain entries under the same `shop-agent` service, so no re-login is required.

**Shop skill 1.1.0.** `skill/SKILL.md` is rewritten: sign-in is offered alongside the first results instead of as a blocking step; the channel table is now capability-based (media, plain-text, link buttons, no-image) with a single-message fallback for harnesses that can't send multiple messages per turn; delegated budgets are only mentioned when the user asks; and only a returned checkout `status` of `completed` counts as a purchase. `references/catalog-mcp.md`, `direct-api.md`, `safety.md`, and `legal.md` are merged into a single `references/direct-api.md`, with the safety and legal rules folded into `SKILL.md`.

**README** rewritten with a quickstart, the checkout lifecycle, delegated budget, secret storage, environment variables, and agent-integration guidance.
