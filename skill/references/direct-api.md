# Direct API (No CLI)

The complete manual for running the Shop skill without the `shop` CLI — over raw HTTPS. Use it when the CLI cannot be installed (blocked package installs, browser-sandboxed harnesses) or when you need to inspect raw request shapes. Prefer the CLI when available: it handles token storage, request construction, and JSON-RPC envelopes.

Behavioral rules (confirmation, warnings, budget etiquette, security) live in SKILL.md and apply unchanged here.

## Authentication

### Token storage

Use the OS/harness secret store with service `shop-agent` and accounts: `access_token`, `refresh_token`, `device_id`, `country`. Keep checkout JWTs, catalog tokens, buyer IP, and UCP payment tokens in memory only.

### Device authorization

Request a device code:

```text
POST https://accounts.shop.app/oauth/device
Content-Type: application/x-www-form-urlencoded

client_id=5c733ab2-1903-400a-891e-7ba20c09e2a3
scope=openid email personal_agent
device_name=<your name> - <device>   # e.g. Max - Mac Mini
```

Show `verification_uri_complete` to the user. Poll:

```text
POST https://accounts.shop.app/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code
device_code=<device_code>
client_id=5c733ab2-1903-400a-891e-7ba20c09e2a3
```

Handle `authorization_pending`, `slow_down`, `expired_token`, and `access_denied`. Store `access_token` and `refresh_token` on success.

Validate: `GET https://accounts.shop.app/oauth/userinfo` with `Authorization: Bearer <access_token>`.

Refresh:

```text
POST https://accounts.shop.app/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
refresh_token=<refresh_token>
client_id=5c733ab2-1903-400a-891e-7ba20c09e2a3
```

### Catalog token exchange (optional)

Signing in is **not** required for catalog calls — unauthenticated search works. When you hold an `access_token`, exchange it for a catalog token and send it as `Authorization: Bearer` on catalog MCP calls:

```text
POST https://shop.app/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<access_token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ietf:params:oauth:token-type:access_token
audience=api.shopify.com
client_id=5c733ab2-1903-400a-891e-7ba20c09e2a3
```

The returned `access_token` is the catalog token. Memory only; re-mint on process restart or a 401. `personal_agent` already grants catalog access — no scope param needed.

### Checkout token exchange (per merchant)

For each merchant domain, mint a short-lived checkout JWT:

```text
POST https://shop.app/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<access_token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
resource=https://{shop_domain}/
client_id=5c733ab2-1903-400a-891e-7ba20c09e2a3
```

If the merchant endpoint returns auth/permission errors, hand off with the variant `checkout_url`, product URL, or seller URL instead of retrying agent checkout. Use the JWT in memory only:

```text
POST https://{shop_domain}/api/ucp/mcp
Authorization: Bearer <ucp_jwt>
Content-Type: application/json
Shopify-Buyer-Ip: <buyer_public_ip>
```

Fetch the buyer's public IP immediately before checkout calls and keep it in memory only (`GET https://api.ipify.org?format=json`). Shopify forwards it as `Shopify-Buyer-Ip` for the same fraud/risk checks as web checkout.

## Catalog MCP

Product search must use the Shopify Global Catalog MCP:

```text
POST https://catalog.shopify.com/api/ucp/mcp
Content-Type: application/json
User-Agent: shop-cli/0.1.0
```

Add `Authorization: Bearer <catalog_token>` when signed in (see *Catalog token exchange*); omit for unauthenticated search. Every tool call includes the agent-profile meta:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "search_catalog",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
        }
      },
      "catalog": {}
    }
  }
}
```

### Search

`search_catalog` discovers products across merchants. The payload is wrapped in `arguments.catalog`:

```json
{
  "catalog": {
    "query": "trail running shoes",
    "pagination": { "limit": 10 },
    "context": {
      "address_country": "US",
      "intent": "Customer runs marathons and wants road shoes"
    },
    "filters": {
      "available": true,
      "ships_to": { "country": "US" },
      "ships_from": [{ "country": "US" }, { "country": "CA" }],
      "price": { "max": 15000 },
      "condition": ["new"],
      "attributes": [
        { "name": "Color", "values": ["White", "Blue"] },
        { "name": "Size", "values": ["M"] },
        { "name": "Target gender", "values": ["Female"] }
      ]
    },
    "view": "compact"
  }
}
```

Field semantics:

- `catalog.query`: free-text query.
- `catalog.like`: similar search by item IDs or image content. Send only IDs/images the user provided; images may contain personal data.
- `catalog.context`: buyer **signals** for relevance/localization — `address_country`, `address_region`, `postal_code`, `language`, `currency`, `intent`. `address_country` is a context signal, not a shipping filter. Pass only signals the user actually provided; never infer or invent them.
- `catalog.filters.ships_to`: hard **filter** to products shipping to a location (`country` ISO 3166-1 alpha-2, `region`, `postal_code`). Independent of `context.address_country`.
- `catalog.filters.ships_from`: merchant-origin filter, a **list** of `{ country }` objects; origins combine with OR.
- `catalog.filters.price`: minor currency units (`15000` = $150.00).
- `catalog.filters.condition`: `new` and/or `secondhand`.
- `catalog.filters.shop_ids` / `catalog.filters.categories`: restrict to shops or taxonomy categories.
- `catalog.filters.attributes`: array of `{ name, values }`. Supported names (exact, case-insensitive): `Color`, `Size`, `Target gender`. Values *within* one entry OR; *separate* entries AND. Limits: ≤25 entries, ≤50 values each. Unknown names aren't errors — they're dropped and reported as `info`/`not_found` in `result.messages[]`. Known caveat: color filters (notably `White`) can surface products whose featured variant is a different color — a product matches if *any* variant matches. Confirm the exact variant via `get_product` before checkout.
- `catalog.view`: `"compact"` (default; still includes `metadata`, `rating`, variant `options`; `top_features`/`tech_specs` are newline-delimited strings) or `"offer"` for comparison shopping.
- `catalog.pagination.limit`: 1–50 (default 10). Keep small — large pages burn tokens.
- `catalog.pagination.cursor`: opaque next-page cursor.

### Pagination

Search responses include `pagination`:

```json
{ "has_next_page": true, "total_count": 649, "cursor": "eyJvZmZzZXQiOjEwLCJ0b3RhbF9jb3VudCI6NjQ5fQ" }
```

When `has_next_page` is true, repeat the request with the returned `cursor` and the **same** query/filters (the offset is encoded in the cursor).

### Similar by ID and image

```json
{ "catalog": { "like": [{ "id": "gid://shopify/ProductVariant/12345" }], "context": { "address_country": "US" }, "filters": { "available": true } } }
```

```json
{ "catalog": { "like": [{ "image": { "content_type": "image/jpeg", "data": "<base64>" } }], "context": { "address_country": "US" } } }
```

### Lookup

`lookup_catalog` for known product or variant IDs:

```json
{ "catalog": { "ids": ["gid://shopify/p/7f3a2b8c1d9e", "gid://shopify/ProductVariant/87654321"], "context": { "address_country": "US" } } }
```

### Get product

`get_product` for options, availability, selected variants, seller domains, and checkout links:

```json
{
  "catalog": {
    "id": "gid://shopify/p/7f3a2b8c1d9e",
    "selected": [
      { "name": "Color", "label": "Black" },
      { "name": "Size", "label": "10" }
    ],
    "preferences": ["Color", "Size"],
    "context": { "address_country": "US" }
  }
}
```

### Response handling

Read `result.structuredContent.products` from search and lookup; `result.structuredContent.product` from `get_product`; `result.structuredContent.pagination` from search.

Variants can include `id`, `price`, `checkout_url`, `availability`, `options`, and `seller` (`name`, `id` = shop GID, `domain`, `url`). Use the variant ID and seller domain for checkout. A variant's `options` is an array of `{ name, label }` — build its display name by joining labels (`Black / 6-12 months`); `variant.title` is frequently just the product title. Products may include `metadata.top_features`, `metadata.tech_specs`, `metadata.attributes` (ML-inferred), and `rating`.

The product-page link comes from `variant.url` (the catalog does not return a product-level `url` in practice; use the first variant's). It is never `seller.url`, which is only the storefront root. Show product URLs and `variant.checkout_url` exactly as returned, preserving all query params (e.g. `_gsid`, `utm_*`) — the catalog already embeds attribution (`utm_source=shopify&utm_medium=catalog`); only if a URL carries no `utm_source` should you append `utm_source=shop-personal-agent&utm_medium=shop-skill`. Never reconstruct a `checkout_url` from a template — use the returned URL verbatim. (The raw API returns `checkout_url` on variants in search, lookup, and get_product responses; the CLI's compact markdown only *renders* it for `get-product`.)

## Checkout

All checkout calls go to `POST https://{shop_domain}/api/ucp/mcp` with the checkout JWT and `Shopify-Buyer-Ip` header (see *Checkout token exchange*).

### Create checkout

Create with line items, or pass a body that already contains a `cart_id`:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "create_checkout",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/personal_agent.json"
        }
      },
      "checkout": {
        "cart_id": "<optional_cart_id>",
        "context": { "address_country": "US" },
        "line_items": [
          { "quantity": 1, "item": { "id": "gid://shopify/ProductVariant/123" } }
        ],
        "fulfillment": {
          "methods": [
            {
              "id": "method-1",
              "type": "shipping",
              "destinations": [
                {
                  "id": "dest-1",
                  "first_name": "Jane",
                  "last_name": "Doe",
                  "street_address": "131 Greene St",
                  "address_locality": "New York",
                  "address_region": "NY",
                  "postal_code": "10012",
                  "address_country": "US"
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

`context.address_country` (ISO2) localizes presentment currency; without it the merchant infers from request geo-IP. It does not override the saved address.

If the response is `ready_for_complete` with a payment instrument, you may complete after the confirmation steps in SKILL.md. If no instrument is present, hand off the UCP `continue_url` as a Finish in Shop link. **If the buyer has a delegated budget (see *Payment budget*) but the checkout returns no instruments, the merchant does not accept Shop Pay** — hand off `continue_url` or suggest another store.

The response may include `messages[]` — surface warnings per SKILL.md's Checkout rules before completing.

### Update checkout

`update_checkout` with the checkout ID from create and only the fields that change:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "update_checkout",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/personal_agent.json"
        }
      },
      "id": "<checkout_id>",
      "checkout": { "email": "buyer@example.com" }
    }
  }
}
```

### Complete checkout

`complete_checkout` charges the buyer — apply SKILL.md's confirmation, idempotency, and completion-status rules.

Echo back the payment instruments the *current* `create_checkout` response returned under `payment.instruments`. Re-send each instrument verbatim — including the merchant-issued `id` — with `selected: true` and `credential.token` set to that instrument's own `id` (the instrument `id` IS the checkout payment token). Never fabricate an instrument `id` such as `instrument-1`; the merchant matches against the id it issued for this session.

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "complete_checkout",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/personal_agent.json"
        },
        "idempotency-key": "<unique_key_for_purchase_intent>"
      },
      "id": "<checkout_id>",
      "checkout": {
        "payment": {
          "instruments": [
            {
              "id": "<instrument_id_from_create_checkout_response>",
              "handler_id": "shop_pay",
              "type": "shop_pay",
              "selected": true,
              "credential": {
                "type": "shop_token",
                "token": "<same_instrument_id_from_create_checkout_response>"
              }
            }
          ]
        }
      }
    }
  }
}
```

## Payment budget (delegated spending)

When the buyer enables purchasing without approval in [Shop → Settings → Connections](https://shop.app/account/settings/connections), Shop issues a budgeted wallet payment token. Read the remaining budget:

```text
GET https://shop.app/pay/agents/payment_tokens
Authorization: Bearer <access_token>
```

Success shape:

```json
{
  "payment_tokens": [
    {
      "id": "<wallet token — never log or persist>",
      "default_currency_code": "USD",
      "display": { "limit": 10000, "remaining_amount": 5750, "renewal_type": "monthly", "renews_at": "2026-05-01T00:00:00Z" }
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

**`limit` and `remaining_amount` are minor units (cents)** — `5750` is $57.50. Empty `payment_tokens` = no delegated budget; `remaining_amount: 0` = budget exhausted. (Stay tolerant: older shapes put the token at `.token`/`.id` and amounts at the root or `.display`.)

Never persist or surface the wallet token value — report only whether a budget exists and how much remains.

**No instruments at checkout:** GET this endpoint to disambiguate. If a token exists, the merchant doesn't accept Shop Pay — hand off `continue_url` or suggest another store; never re-prompt to set up a budget. If no token exists, hand off the Finish in Shop link; mention budget setup only if the user asks to buy without per-purchase approval (see SKILL.md, *Spending budget*).

## Orders

Authenticated order search:

```text
GET https://shop.app/agents/orderSearch?type=recent
GET https://shop.app/agents/orderSearch?type=tracking&query=<string>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
Authorization: Bearer <access_token>
x-device-id: <device_id>
```

Types: `recent`, `tracking`, `order_info`, `returns`, `reorder`.

The response is `text/markdown` (a short summary), not JSON — no cursor to page through. A non-`recent` search summarizes the single best-matching order; narrow `query`/`dateFrom`/`dateTo` to surface a different one. `recent` returns the most recent orders in one response.
