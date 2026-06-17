---
'@shopify/shop-cli': patch
---

Add `--country` to `checkout create`, setting `checkout.context.address_country` so the merchant resolves presentment currency to the buyer's country. Falls back to the stored `config set-country` preference (but never a default country); stdin context wins; the saved address is not overridden.
