---
"@shopify/shop-cli": minor
---

Add Color, Size, and Target gender attribute filters to `shop search`.

- New flags `--color`, `--size`, and `--gender` accept comma-separated taxonomy attribute values (e.g. `--color White,Blue --size M --gender Female`).
- All three map onto the catalog API's single `filters.attributes` array as `{ name, values }` entries. Values within one attribute combine with OR; separate attributes combine with AND.
- Supported attribute names are `Color`, `Size`, and `Target gender` (per shop/world#792867). Unsupported names are dropped by the API and surfaced via `result.messages[]`.
