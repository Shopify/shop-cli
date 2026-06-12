---
"@shopify/shop-cli": patch
---

Fix keytar CJS/ESM interop that broke every secret-store write.

Under ESM, `import('keytar')` produced a namespace where some named exports (e.g. `getPassword`) were present but the write methods (`setPassword`, `deletePassword`) were `undefined` — the complete API lives on `.default`. As a result `store.set`/`store.delete` threw `keytar.setPassword is not a function`, breaking `auth login`, `auth poll`, `config set-country`, device-id persistence, and any command that writes to the keychain.

`KeytarSecretStore` now resolves the module via `.default` (falling back to the namespace) and only uses it when the read **and** write methods are functions; otherwise it falls back to the macOS `security` CLI instead of throwing.
