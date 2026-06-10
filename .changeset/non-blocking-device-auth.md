---
"@shopify/shop-cli": minor
---

Split the blocking `shop auth login` device flow into two non-blocking commands so agents reliably persist tokens.

- `shop auth device-code` requests the code, persists pending state, prints the sign-in URL to stdout, and exits immediately (no polling).
- `shop auth poll` reads the pending code, exchanges it, and stores the tokens in one short call. It is re-runnable and reports `pending | expired | denied | no_pending` instead of blocking.

This fixes a class of failures where `shop auth login` (a single long-lived polling process that only saved tokens at the very end) was terminated before the user finished authorizing, leaving the keychain empty. `shop auth login` is retained for interactive human terminal use.
