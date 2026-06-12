---
"@shopify/shop-cli": minor
---

Add delegated-budget awareness: a `shop auth budget` command and automatic Shop Pay availability detection at checkout.

- `shop auth budget` reads `GET https://shop.app/pay/agents/payment_tokens` and returns `{ available, limit?, remaining_amount?, currency?, renewal_type?, renews_at?, units: "minor" }` (amounts in minor units), or `{ available: false }` when no budget is set. The raw wallet token is never surfaced or persisted.
- Sign-in now requests the `pay:wallet_tokens:read` scope (required by the budget endpoint; not unrolled from `personal_agent`). If a token ever lacks it, the budget read degrades to `{ available: false, reason: "missing_payment_scope" }` instead of breaking sign-in.
- `shop checkout create` / `update` now disambiguate an empty `payment.instruments`: the CLI probes the budget endpoint once and adds a `shop_pay_availability` block with `budget_available` and a `message`. When `budget_available: true` the buyer has budget but this store doesn't accept Shop agent payments yet, so the agent should search for similar alternatives; when `false` the agent should offer to set up a budget. This resolves the confusing "no token returned" checkout state.
