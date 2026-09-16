# Shop CLI

Shop CLI lets agents search, compare, and buy across millions of Shopify stores through the Shop catalog — and track, return, or reorder past purchases — using the buyer's own Shop account, without ever handling raw card details.

The CLI covers the full shopping loop:

- **Catalog search** across all Shop merchants — free text, similar-item (`--like-id`), or image search. Works signed out.
- **Sign in with Shop** via the OAuth device flow, so the agent never sees a password.
- **Agentic checkout** over UCP (create → update → complete), paying with Shop Pay or handing off a Finish-in-Shop link.
- **Orders** — recent purchases, tracking, order details, returns, and reorders.

It has no native dependencies: the only runtime dependency is `commander`, so it installs cleanly in sandboxed agent environments where native builds fail.

Documentation:

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Advanced usage](#advanced)
  - [Authentication](#authentication)
  - [The checkout lifecycle](#the-checkout-lifecycle)
  - [Payment budget (delegated spending)](#payment-budget-delegated-spending)
  - [Secret storage](#secret-storage)
  - [Output formats](#output-formats)
  - [Environment variables](#environment-variables)
- [Integrating into your agent](#integrating-into-agents)
- [Personal-use limits](#personal-use-limits)
- [Development](#development)

> [!TIP]
> If you're wiring this into an agent, start with the bundled skill in [`skill/SKILL.md`](skill/SKILL.md) — it's the playbook that drives the end-to-end shopping conversation and calls these commands under the hood. The hosted copy lives at https://shop.app/skill.md.

## Installation

Requires Node.js >= 20.

```bash
pnpm add --global @shopify/shop-cli
```

Or with npm:

```bash
npm install --global @shopify/shop-cli
```

Upgrade with `@latest`; uninstall with `pnpm rm -g @shopify/shop-cli` (or `npm rm -g @shopify/shop-cli`).

### Use with agents

The package bundles the Shop skill (`skill/SKILL.md` plus references) — the agent-facing instructions for the full flow: search etiquette, per-channel message formatting, sign-in choreography, and the checkout confirmation gate.

Output defaults to compact markdown; all commands accept `--format md|json` (auth and checkout always emit JSON). Keep `--limit` small on searches — large JSON pages burn tokens.

## Quickstart

### Check auth, sign in

```bash
shop auth status          # {"authenticated": false}
shop auth device-code     # prints a sign-in URL — show it to the user, then STOP
shop auth poll            # after the user approves, exchanges and stores tokens
```

Signing in is optional for search, required for checkout and orders.

### Search

Always pass the buyer's country and currency; default `--ships-to` to the same country:

```bash
shop search "trail running shoes" --country US --currency USD --ships-to US --limit 8
shop search "tshirt" --country US --color White --size M
shop search --like-id gid://shopify/p/abc123 --ships-to US   # similar items
shop search --image ./photo.jpg --country US                 # visual search (jpeg/png/webp/avif/heic, ~3 MB max)
```

Prices are minor units (`--max-price 15000` = $150.00).

### Inspect a product

```bash
shop catalog get-product gid://shopify/p/abc123
shop catalog lookup gid://shopify/ProductVariant/50362300006715
```

`get-product` is where variant-level `checkout_url` links come from — never reconstruct one.

### Checkout

```bash
shop checkout create --shop-domain example.myshopify.com \
  --variant-id gid://shopify/ProductVariant/123 --quantity 1 --country US --checkout-stdin

shop checkout complete --shop-domain example.myshopify.com \
  --checkout-id <id> --checkout-stdin --confirm --idempotency-key <key>
```

`--confirm` is a deliberate, separate step: verify item, variant, quantity, address, shipping, and total with the user first, and surface every `messages[]` warning verbatim (final sale, age restricted, Prop 65). Use a fresh idempotency key per distinct purchase intent. Only a returned status of `completed` means the purchase went through.

### Orders

```bash
shop orders search --type recent
shop orders search --type tracking --query "shoes"
shop orders search --type reorder --query "coffee"
```

## Advanced

### Authentication

```bash
shop auth status       # check session (validates + auto-refreshes)
shop auth device-code  # phase 1: request device code, print verification URL
shop auth poll         # phase 2: poll token endpoint, store tokens
shop auth budget       # remaining delegated-spend budget, if configured
shop auth logout       # clear all stored credentials
```

The device flow is split into two commands so agents can return control to the user between turns: `device-code` stashes the pending `device_code` in the secret store; `poll` reads it back and exchanges it. Poll handles `authorization_pending`, `slow_down`, `expired_token`, and `access_denied`.

Tokens are stored under the service `shop-agent` (accounts `access_token`, `refresh_token`, `device_id`, `country`). Short-lived checkout JWTs and catalog tokens are minted on demand and kept in memory only.

### The checkout lifecycle

A checkout moves through **create → (update) → complete**:

- `create` returns a checkout with totals, fulfillment options, `messages[]`, and — if the buyer has Shop Pay set up with a delegated budget — `payment.instruments`.
- `update` patches only the fields you pass (email, address, method) using the checkout id from create.
- `complete` echoes the instrument from the *current* create/update response verbatim (`selected: true`, `credential.token` = the instrument's own `id`). Never fabricate instrument ids.

If a checkout returns no payment instruments, don't retry: hand off the `continue_url` as a Finish-in-Shop link. If the merchant endpoint returns auth or permission errors, fall back to the variant `checkout_url` or product URL.

### Payment budget (delegated spending)

Buyers can pre-authorize agent spending in [Shop → Settings → Connections](https://shop.app/account/settings/connections). `shop auth budget` reports the limit and remaining amount in minor units (`5750` = $57.50). Empty = no budget configured; `0` = exhausted. The wallet token itself is never printed or persisted — the CLI only reports availability and remaining amount, and the user can revoke it at any time.

A budget exists but checkout returns no instruments? The merchant doesn't accept Shop Pay — hand off `continue_url`; don't re-prompt the user to set up a budget they already have.

### Secret storage

Backend resolution order:

1. `SHOP_CLI_SECRET_BACKEND` env override (`keychain` | `secret-tool` | `file`)
2. macOS → Keychain (`security` CLI, always present on darwin)
3. Linux with a working secret service → `secret-tool`
4. Otherwise → JSON file at `SHOP_CLI_SECRETS_PATH` or `~/.shop-cli/secrets.json`

The file store creates its directory `0700`, writes atomically (temp file + rename), and keeps the file `0600`. It holds the OAuth access/refresh tokens — treat it like an SSH key. On shared machines prefer a real keychain backend or `--memory-store`.

File operations use an exclusive directory lock at `<secrets-path>.lock`, covering the read, modification, and atomic replacement across CLI processes and store instances. Lock acquisition times out after five seconds rather than proceeding unlocked. A process killed while holding the lock can leave that directory behind: stop all CLI processes using this store before removing the orphaned lock directory, then retry. Do not delete the credentials file or remove a lock held by a running process. Locking protects individual storage operations, not an entire multi-command sign-in or sign-out transaction.

```bash
SHOP_CLI_SECRET_BACKEND=file shop auth status   # force + acknowledge the file store
shop --memory-store auth status                 # nothing persisted (per-process)
```

### Output formats

`--format md` (default) renders compact markdown; `--format json` returns full payloads. Auth and checkout commands always emit JSON; orders always emit markdown (the API returns a text summary, not JSON). Search's markdown omits per-variant checkout links to keep lists small — use `catalog get-product` for those.

### Environment variables

| Variable | Effect |
|---|---|
| `SHOP_CLI_SECRET_BACKEND` | Force a secret backend: `keychain`, `secret-tool`, or `file` |
| `SHOP_CLI_SECRETS_PATH` | File-store location (default `~/.shop-cli/secrets.json`) |

Global flags: `--country <ISO2>` (context signal; persist with `shop config set-country`), `--profile-url <url>` (override the UCP agent profile), `--memory-store`, `--format md|json`.

## Integrating into agents

Give your agent the bundled skill (`skill/SKILL.md`) or point it at https://shop.app/skill.md. The skill encodes the rules that matter for real money: sign-in choreography, the confirm-before-complete gate, verbatim warning disclosure, prompt-injection defenses, and per-channel formatting. Agents that can't install the CLI at all can follow the raw API reference in [`skill/references/direct-api.md`](skill/references/direct-api.md) — same endpoints, no install.

## Personal-use limits

This CLI is designed for individual end users, for personal use. The Shopify servers it connects to have usage restrictions. Building commercial services, resale platforms, aggregators, or anything that provides third parties with programmatic access to Shopify's catalog, checkout, delegated payments, or aggregated user data is prohibited.

See https://help.shop.app/en/shop/shopping/personal-agents for accepted and prohibited use.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build           # tsc → dist/, marks dist/bin.js executable
pnpm shop -- --help
```

The secret store lives in [`src/storage.ts`](src/storage.ts) (`PortableSecretStore`) — backend resolution is documented under [Secret storage](#secret-storage).

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before getting started.

## License

MIT. See [LICENSE.md](./LICENSE.md).
