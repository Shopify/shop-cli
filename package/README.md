# Shop CLI

Personal shopping CLI for Shop catalog search, checkout, and order workflows.

> This package is publicly installable, but it is not open source. See [License](#license).

## Install

```bash
pnpm add --global @shopify/shop-cli
```

Or with npm:

```bash
npm install --global @shopify/shop-cli
```

## Usage

```bash
shop --help
shop search "trail running shoes" --limit 10
shop catalog lookup gid://shopify/ProductVariant/50362300006715
shop auth login
shop auth status
```

## Commands

### Search catalog

```bash
shop search "black crewneck sweater" --limit 10
shop search "boots" --ships-to US --country US
shop search --like-id gid://shopify/p/abc123
shop search --image ./photo.jpg
```

Useful flags:

```text
--country <ISO2>       Buyer country/catalog context
--ships-to <ISO2>      Filter to products that ship to the destination
--limit <number>       Result limit, 1-50
--format md|json       Output format for catalog results
```

### Catalog lookup

```bash
shop catalog lookup <product-or-variant-id...>
shop catalog get-product <product-or-variant-id>
```

### Auth

```bash
shop auth login
shop auth status
shop auth logout
```

### Checkout

```bash
printf '{"email":"buyer@example.com"}' | \
  shop checkout create \
    --shop-domain example.myshopify.com \
    --variant-id 123 \
    --quantity 1 \
    --checkout-stdin
```

`shop checkout complete` requires `--confirm` and should only be used after confirming the item, variant, quantity, price, shipping, and total cost.

### Orders

```bash
shop orders search --type recent
shop orders search --type tracking --query "running shoes"
shop orders search --type returns --query "jacket"
shop orders search --type reorder --query "coffee"
```

## Personal-use limits

This CLI is for individual end-users only. Building commercial services, resale platforms, aggregators, or anything that provides third parties with programmatic access to Shopify's catalog, checkout, delegated payments, or aggregated user data is prohibited.

See https://help.shop.app/shop/shopping/personal-agents for accepted and prohibited use.

## License

Copyright Shopify Inc. All rights reserved.

This package is not open source. See [LICENSE.md](./LICENSE.md).
