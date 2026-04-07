# shop

A CLI for searching products, managing orders, and shopping across all online stores via [Shop](https://shop.app). Designed as a tool-use backend for AI agents.

## Features

| Command | Auth | Description |
|---------|------|-------------|
| `shop search <query>` | No | Search the global product catalog with price, category, and shipping filters |
| `shop similar --id <id>` | No | Find visually similar products by product ID |
| `shop similar --image <path>` | No | Find visually similar products by image (JPEG/PNG/WebP/GIF) |
| `shop checkout <items>` | No | Build a checkout URL from variant IDs and quantities |
| `shop shipping <domain>` | No | View a store's shipping policy |
| `shop orders` | Yes | List recent orders across all stores |
| `shop order <id>` | Yes | Show order details by UUID or tracker ID |
| `shop track <id>` | Yes | Show tracking and delivery status |
| `shop returns <uuid>` | Yes | Check return eligibility and return policy |
| `shop spending` | Yes | Analyze spending totals by merchant |
| `shop reorder <uuid>` | Yes | Generate a checkout URL to re-buy a past order |
| `shop auth init` | No | Start the OAuth device authorization flow |
| `shop auth status` | No | Check current authentication status |
| `shop auth refresh` | No | Force a token refresh |
| `shop auth save` | No | Import tokens from a file or stdin |
| `shop auth logout` | No | Remove saved tokens |

All commands support `--json` for structured JSON output. Default output is markdown.

## Shopify Endpoints

### Catalog API (unauthenticated)

**`GET https://shop.app/web/api/catalog/search`** -- Product search. Accepts query parameters for keyword search, price range, shipping country, category filters, and shop IDs. Returns results in markdown or JSON.

**`POST https://shop.app/web/api/catalog/search`** -- Similar products. Accepts a product variant ID or a base64-encoded image in the request body. Returns visually similar products.

### Shop Orders GraphQL (authenticated)

**`POST https://server.shop.app/graphql`** -- All order-related operations use this single GraphQL endpoint with Bearer token auth.

- **`OrdersList` query** -- Paginated list of orders and trackers. Returns order details (name, number, prices, status, ETA), line items, trackers with carrier info, and shipping addresses. Used by `orders`, `order`, `track`, `spending`, `reorder`, and `returns`.

### Storefront API (authenticated)

- **`StorefrontProduct` query** -- Fetches product and shop details including shipping and return policies. Returns policy embed URLs which are then fetched and stripped to plain text. Used by `returns` and `shipping`.

### Shop Identity / OAuth

- **`POST https://accounts.shop.app/oauth/device`** -- Initiates the device authorization flow. Returns a `device_code`, `user_code`, and `verification_uri_complete` for the user to visit.
- **`POST https://accounts.shop.app/oauth/token`** -- Exchanges a device code for tokens (access + refresh), or refreshes an expired access token.
- **`GET https://server.shop.app/oauth/userinfo`** -- Validates the access token and returns the user's profile (email, name).

## How OAuth Works

This CLI uses the **OAuth 2.0 Device Authorization Grant** ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)), which is ideal for CLI tools and agents that don't have a browser redirect URI.

```
1. CLI requests a device code from accounts.shop.app/oauth/device
2. User opens the verification URL in a browser and approves access
3. CLI polls accounts.shop.app/oauth/token until the user approves
4. Server returns access_token + refresh_token
5. Tokens are saved to ~/.shop/tokens.json (mode 0600)
6. On expiry, the CLI auto-refreshes using the refresh_token
```

**Scope:** `agent:access email openid orders profile`

**Token storage:** `~/.shop/tokens.json` with `0600` permissions. Contains the access token, refresh token, expiry timestamp, and cached userinfo.

## Intended Users

This CLI is built for **AI agents** that need to search for products, place orders, and manage shopping on behalf of users. It is the primary backend for [Openclaw](https://github.com/anthropics/openclaw) (Claude's shopping agent) and other LLM-based agents that interact with Shop.

The markdown-first output format and structured `--json` mode are designed for easy parsing by agents. Unauthenticated commands (search, similar, checkout) work without any setup, making them immediately usable as agent tools.

Human users can also use it directly as a terminal shopping tool.

## Dependencies

| Package | Purpose |
|---------|---------|
| [`commander`](https://www.npmjs.com/package/commander) ^13.1.0 | CLI framework (commands, options, help) |

That's it. Everything else uses Node.js built-ins (`fs`, `path`, `https`, `crypto`, `child_process`). Tests use the native `node:test` module.

**External APIs** (no npm packages required):
- [Frankfurter](https://api.frankfurter.dev) -- Currency conversion rates, cached locally for 1 hour

## Installation

```sh
pnpm install -g shop-1.0.0.tgz
shop --version
```

## Quick Start

```sh
# Search without auth
shop search "wireless headphones" --max-price 100 --ships-to US

# Authenticate
shop auth init

# View recent orders
shop orders

# Track a delivery
shop track <order-uuid>
```

## Rate Limits

Authenticated endpoints (orders, track, returns, spending, reorder) are rate-limited to **50 requests/minute**. The CLI does not batch calls -- agents should wait 3-10 seconds between requests and back off on 429 responses.
