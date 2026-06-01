# Direct Global Catalog MCP

Use this reference when the CLI cannot be installed or when you need to inspect the raw request shape. Product search must use Shopify Global Catalog MCP.

Endpoint:

```text
POST https://catalog.shopify.com/api/ucp/mcp
Content-Type: application/json
```

Every tool call includes:

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

## Search

`search_catalog` discovers products across merchants. The request payload is wrapped in `arguments.catalog`.

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
          "price": { "max": 15000 },
          "condition": ["new"]
        },
        "view": "compact"
      }
    }
  }
}
```

Important fields:

- `catalog.query`: free-text query.
- `catalog.like`: similar search by item IDs or image content.
- `catalog.context`: buyer **signals** for relevance/localization such as `address_country`, `address_region`, `postal_code`, `language`, `currency`, and `intent`. `address_country` is a context signal, not a shipping filter.
- `catalog.filters.ships_to`: hard **filter** to products that ship to a location. Accepts `country` (ISO 3166-1 alpha-2), `region`, `postal_code`. Critical when shipping eligibility matters. Only set this when you actually want to restrict by destination; it is independent of `context.address_country`.
- `catalog.filters.ships_from`: filter by merchant origin `country` (ISO 3166-1 alpha-2).
- `catalog.filters.price`: minor currency units, e.g. `15000` means `$150.00`.
- `catalog.filters.condition`: `new` and/or `secondhand`.
- `catalog.filters.shop_ids` / `catalog.filters.categories`: restrict to shops or taxonomy categories.
- `catalog.view`: predefined output shape, e.g. `"compact"` for a trimmed payload or `"offer"` for comparison shopping. The CLI defaults to `compact`. Note that `compact` still includes `metadata` (top_features, tech_specs), `rating`, and variant `options`; `top_features` and `tech_specs` are returned as newline-delimited strings, not arrays.
- `catalog.pagination.limit`: 1-50; global catalog does not support cursor pagination yet.

Similar by ID:

```json
{
  "catalog": {
    "like": [{ "id": "gid://shopify/ProductVariant/12345" }],
    "context": { "address_country": "US" },
    "filters": { "available": true }
  }
}
```

Similar by image:

```json
{
  "catalog": {
    "like": [
      {
        "image": {
          "content_type": "image/jpeg",
          "data": "<base64>"
        }
      }
    ],
    "context": { "address_country": "US" }
  }
}
```

## Lookup

Use `lookup_catalog` for known product or variant IDs.

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "lookup_catalog",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
        }
      },
      "catalog": {
        "ids": [
          "gid://shopify/p/7f3a2b8c1d9e",
          "gid://shopify/ProductVariant/87654321"
        ],
        "context": { "address_country": "US" }
      }
    }
  }
}
```

## Get Product

Use `get_product` to inspect options, availability, selected variants, seller domains, and checkout links.

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "get_product",
    "arguments": {
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
        }
      },
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
  }
}
```

## Response Handling

Read `result.structuredContent.products` from search and lookup responses. Read `result.structuredContent.product` from `get_product`.

Product variants can include `id`, `price`, `checkout_url`, `availability`, `options`, and `seller` (`name`, `id` = shop GID, `domain`, `url`). Use the variant ID and seller domain for checkout. A variant's `options` is an array of `{ name, label }` (e.g. `[{name:'Color',label:'Black'},{name:'Size',label:'6-12 months'}]`); build its display name by joining the labels (`Black / 6-12 months`). Note `variant.title` is frequently the product title, so prefer the option labels for naming. Products may include `metadata.top_features`, `metadata.tech_specs`, and `metadata.attributes` (ML-inferred), plus `rating`.

When presenting links to the user, show the product-page URL and `variant.checkout_url` as returned and append `utm_source=shop-website&utm_medium=shop-skill`, preserving any existing query params (e.g. `_gsid`). Never reconstruct a `checkout_url` from a template — use the URL the response provides verbatim.

The product-page link comes from `variant.url` (the catalog does not return a product-level `url` in practice; use the first variant's `url`). It is never `seller.url`, which is only the storefront root. The CLI's compact markdown only renders per-variant `checkout_url` lines for `get_product`; `search_catalog` and `lookup_catalog` omit them to keep result lists compact. Pull a variant's `checkout_url` from a `get_product` call (or `--format json`).
