# @shopify/shop-cli

## 0.2.0

### Minor Changes

- 0753699: Drop the native `keytar` dependency in favour of a portable secret store, and ship Shop skill 1.1.0.

  **Portable secret storage.** `KeytarSecretStore` is replaced by `PortableSecretStore`, which has no native dependencies (the only runtime dependency is now `commander`). This lets the CLI install in sandboxed agent environments where the `keytar` native build fails. Backend resolution order:

  1. `SHOP_CLI_SECRET_BACKEND` env override (`keychain` | `secret-tool` | `file`)
  2. macOS → Keychain via the `security` CLI
  3. Linux with a working secret service → `secret-tool`
  4. Otherwise → a `0600` JSON file at `SHOP_CLI_SECRETS_PATH` or `~/.shop-cli/secrets.json` (with a one-time stderr notice when reached implicitly)

  The Linux probe falls back to the file store when `secret-tool` cannot connect to a Secret Service or the probe times out, so headless sessions reuse file-backed credentials across commands without requiring a backend override. The file backend serialises operations within one store instance. Existing macOS users keep their Keychain entries under the same `shop-agent` service, so no re-login is required.

  **Shop skill 1.1.0.** `skill/SKILL.md` is rewritten: sign-in is offered alongside the first results instead of as a blocking step; the channel table is now capability-based (media, plain-text, link buttons, no-image) with a single-message fallback for harnesses that can't send multiple messages per turn; delegated budgets are only mentioned when the user asks; and only a returned checkout `status` of `completed` counts as a purchase. `references/catalog-mcp.md`, `direct-api.md`, `safety.md`, and `legal.md` are merged into a single `references/direct-api.md`, with the safety and legal rules folded into `SKILL.md`.

  **README** rewritten with a quickstart, the checkout lifecycle, delegated budget, secret storage, environment variables, and agent-integration guidance.

## 0.1.3

### Patch Changes

- ed71a90: Fix `shop --version` and the User-Agent header reporting a stale hard-coded version.

## 0.1.2

### Patch Changes

- db77df1: Add `--country` to `checkout create`, setting `checkout.context.address_country` so the merchant resolves presentment currency to the buyer's country. Falls back to the stored `config set-country` preference (but never a default country); stdin context wins; the saved address is not overridden.

## 0.1.1

### Patch Changes

- afe8b5f: Fix skill doc inconsistencies surfaced in review

## 0.1.0

### Minor Changes

- 7d28257: Add delegated-budget awareness: a `shop auth budget` command and automatic Shop Pay availability detection at checkout.

  - `shop auth budget` reads `GET https://shop.app/pay/agents/payment_tokens` and returns `{ available, limit?, remaining_amount?, currency?, renewal_type?, renews_at?, units: "minor" }` (amounts in minor units), or `{ available: false }` when no budget is set. The raw wallet token is never surfaced or persisted.
  - Sign-in now requests the `pay:wallet_tokens:read` scope (required by the budget endpoint; not unrolled from `personal_agent`). If a token ever lacks it, the budget read degrades to `{ available: false, reason: "missing_payment_scope" }` instead of breaking sign-in.
  - `shop checkout create` / `update` now disambiguate an empty `payment.instruments`: the CLI probes the budget endpoint once and adds a `shop_pay_availability` block with `budget_available` and a `message`. When `budget_available: true` the buyer has budget but this store doesn't accept Shop agent payments yet, so the agent should search for similar alternatives; when `false` the agent should offer to set up a budget. This resolves the confusing "no token returned" checkout state.

- 0d8c356: Update catalog `ships_from` to a list and add cursor pagination to `shop search`.

  - `filters.ships_from` is now sent as a list of `{ country }` origin objects (per shop/world#796951). The catalog rejects the previous single-object shape, so `--ships-from` now accepts a comma-separated list of ISO2 countries (e.g. `--ships-from US,CA`); origins combine with OR.
  - New `--cursor` flag on `shop search` walks results page by page. Each search response surfaces the next-page cursor and estimated total in the markdown footer when more results exist; re-run the same query/filters with `--cursor <cursor>` to fetch the next page.
  - `--limit` still accepts up to 50, but large pages burn tokens — keep it small (6-8 is plenty).

- 918ae36: Identify Shop CLI traffic using a standard `User-Agent` header (`shop-cli/<version>`) on every outbound request, instead of a custom `X-Shopify-Agent-Source` header.
- 85406cb: Add Color, Size, and Target gender attribute filters to `shop search`.

  - New flags `--color`, `--size`, and `--gender` accept comma-separated taxonomy attribute values (e.g. `--color White,Blue --size M --gender Female`).
  - All three map onto the catalog API's single `filters.attributes` array as `{ name, values }` entries. Values within one attribute combine with OR; separate attributes combine with AND.
  - Supported attribute names are `Color`, `Size`, and `Target gender` (per shop/world#792867). Unsupported names are dropped by the API and surfaced via `result.messages[]`.

- 85406cb: Split the blocking `shop auth login` device flow into two non-blocking commands so agents reliably persist tokens.

  - `shop auth device-code` requests the code, persists pending state, prints the sign-in URL to stdout, and exits immediately (no polling).
  - `shop auth poll` reads the pending code, exchanges it, and stores the tokens in one short call. It is re-runnable and reports `pending | expired | denied | no_pending` instead of blocking.

  This fixes a class of failures where `shop auth login` (a single long-lived polling process that only saved tokens at the very end) was terminated before the user finished authorizing, leaving the keychain empty. `shop auth login` is retained for interactive human terminal use.

### Patch Changes

- 9a495b9: Bundle the `skill/` directory (SKILL.md and reference files) in the published package so the skill ships and versions in lockstep with the CLI.
- 51000d8: Guide agents to set `--device-name` to their own name plus host device (e.g. `Max - Mac Mini`) so the Shop Connections entry is self-identifying. Document where to source the agent name per harness: `IDENTITY.md` (OpenClaw) or `~/.hermes/SOUL.md` (Hermes).
- 7d28257: Fix keytar CJS/ESM interop that broke every secret-store write.

  Under ESM, `import('keytar')` produced a namespace where some named exports (e.g. `getPassword`) were present but the write methods (`setPassword`, `deletePassword`) were `undefined` — the complete API lives on `.default`. As a result `store.set`/`store.delete` threw `keytar.setPassword is not a function`, breaking `auth login`, `auth poll`, `config set-country`, device-id persistence, and any command that writes to the keychain.

  `KeytarSecretStore` now resolves the module via `.default` (falling back to the namespace) and only uses it when the read **and** write methods are functions; otherwise it falls back to the macOS `security` CLI instead of throwing.
