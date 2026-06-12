# Shop CLI

Personal shopping CLI for the Shop catalog: search millions of stores, look up products, sign in to your Shop account, build and complete UCP checkouts, and search your orders for tracking, returns, and reorders.

It talks to the Shopify Global Catalog over MCP and to Shop's auth, checkout, and orders APIs. Tokens are stored in your OS secret store via `keytar`.

## Companion to the Shop skill

This CLI is the companion to the **Shop skill**, the agent-facing playbook that drives the end-to-end shopping conversation. The skill calls these commands under the hood and documents every command, flag, and workflow in full.

The skill lives at **https://shop.app/SKILL.md** — see it for the complete reference.

## Install

```bash
pnpm add --global @shopify/shop-cli
```

Or with npm:

```bash
npm install --global @shopify/shop-cli
```

Requires Node.js >= 20.

## Usage

```bash
shop --help
shop auth status
shop search "trail running shoes" --limit 10
shop catalog lookup gid://shopify/ProductVariant/50362300006715
shop orders search --type recent
```

## Commands

- `shop search` — search the catalog by text, similar items (`--like-id`), or image (`--image`).
- `shop catalog lookup` / `shop catalog get-product` — look up IDs you already hold and fetch full product detail.
- `shop auth` — sign in (`login`, or the non-blocking `device-code` + `poll`), check `status`, read the remaining delegated spending `budget`, or `logout`.
- `shop checkout` — `create`, `update`, and `complete` a UCP checkout on the merchant domain (`complete` requires `--confirm`).
- `shop orders search` — search recent orders, tracking, order info, returns, and reorder candidates.
- `shop config` — persist CLI preferences such as a default country.

Run `shop <command> --help` for the flags on any command, and see the [Shop skill](https://shop.app/SKILL.md) for the full reference and shopping workflow.

## Personal-use limits

This CLI is for individual end-users only. Building commercial services, resale platforms, aggregators, or anything that provides third parties with programmatic access to Shopify's catalog, checkout, delegated payments, or aggregated user data is prohibited.

See https://help.shop.app/shop/shopping/personal-agents for accepted and prohibited use.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before getting started.

## License

MIT. See [LICENSE.md](./LICENSE.md).
