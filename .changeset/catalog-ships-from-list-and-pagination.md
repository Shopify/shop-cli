---
"@shopify/shop-cli": minor
---

Update catalog `ships_from` to a list and add cursor pagination to `shop search`.

- `filters.ships_from` is now sent as a list of `{ country }` origin objects (per shop/world#796951). The catalog rejects the previous single-object shape, so `--ships-from` now accepts a comma-separated list of ISO2 countries (e.g. `--ships-from US,CA`); origins combine with OR.
- New `--cursor` flag on `shop search` walks results page by page. Each search response surfaces the next-page cursor and estimated total in the markdown footer when more results exist; re-run the same query/filters with `--cursor <cursor>` to fetch the next page.
- `--limit` still accepts up to 50, but large pages burn tokens — keep it small (6-8 is plenty).
