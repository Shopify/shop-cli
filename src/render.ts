// Compact markdown rendering for catalog responses.
//
// All values are sourced strictly from the MCP response — nothing is fabricated
// or recreated. Links (product page + variant checkout) get UTM attribution
// params appended while preserving any existing query string (e.g. the `_gsid`
// that the catalog response already includes). Missing fields are simply omitted.
//
// The product link is always the product page (`product.url`) — never the
// storefront root (`seller.url`). Per-variant checkout links are only rendered
// for `get_product` (a single-product detail view); search/lookup return many
// products, so their per-variant checkout URLs would be noise.

import type { JsonObject } from './types.js'

const UTM_PARAMS: Record<string, string> = {
  utm_source: 'shop-personal-agent',
  utm_medium: 'shop-skill',
}

// Append UTM attribution params to a URL, preserving existing query params
// (including any `_gsid` the catalog response already attached). Returns the
// original string unchanged if it is not a parseable absolute URL.
export function withUtm(url: string): string {
  try {
    const parsed = new URL(url)
    for (const [key, value] of Object.entries(UTM_PARAMS)) {
      if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function renderCatalogResult(toolName: string, json: unknown): string {
  const structured = getStructuredContent(json)
  if (!structured) return '_No catalog data in response._'

  // Only the single-product detail view shows per-variant checkout links.
  const includeCheckout = toolName === 'get_product'

  if (toolName === 'get_product') {
    const product = isObject(structured.product) ? structured.product : undefined
    if (!product) return '_Product not found._'
    return renderProduct(product, { includeCheckout })
  }

  const products = Array.isArray(structured.products) ? structured.products : []
  const blocks = products.filter(isObject).map((p) => renderProduct(p as JsonObject, { includeCheckout }))
  const messages = renderMessages(structured.messages)

  if (blocks.length === 0) {
    return messages || '_No products found._'
  }
  return [blocks.join('\n\n---\n\n'), messages].filter(Boolean).join('\n\n')
}

function renderProduct(product: JsonObject, opts: { includeCheckout: boolean }): string {
  const lines: string[] = []
  const title = asString(product.title) ?? 'Untitled product'
  lines.push(title)

  const variants = Array.isArray(product.variants) ? product.variants.filter(isObject) : []
  const firstVariant = variants[0] as JsonObject | undefined
  const seller = isObject(firstVariant?.seller) ? (firstVariant!.seller as JsonObject) : undefined

  // "$129.95 CAD at Kozmo Shoes [29950112] — 4.7/5 (18 reviews)"
  const priceLine: string[] = []
  const price = formatPrice(product.price_range, firstVariant?.price)
  if (price) priceLine.push(price)
  if (seller?.name) priceLine.push(`at ${asString(seller.name)}`)
  const shopId = shortId(asString(seller?.id))
  if (shopId) priceLine.push(`[${shopId}]`)
  let priceText = priceLine.join(' ')
  const rating = formatRating(product.rating)
  if (rating) priceText = priceText ? `${priceText} — ${rating}` : rating
  if (priceText) lines.push(priceText)

  // Always link the product page, never the storefront root (seller.url).
  // The product-page URL lives on the variant (`variant.url`); the catalog
  // does not return a product-level `url` in practice, so fall back to the
  // first variant's url.
  const productUrl = asString(product.url) ?? asString(firstVariant?.url)
  if (productUrl) lines.push(withUtm(productUrl))

  const img = firstMediaUrl(product.media)
  if (img) lines.push(`Img: ${img}`)

  const upid = shortId(asString(product.id))
  if (upid) lines.push(`id: ${upid}`)

  const description = formatDescription(product.description)
  if (description) lines.push(`\n${description}`)

  const metadata = isObject(product.metadata) ? (product.metadata as JsonObject) : undefined
  const features = stringList(metadata?.top_features)
  if (features.length) lines.push(`\nFeatures: ${features.join(' | ')}`)
  const specs = stringList(metadata?.tech_specs)
  if (specs.length) lines.push(`Specs: ${specs.join(' | ')}`)
  for (const attr of attributeLines(metadata?.attributes)) lines.push(attr)

  const optionLines = renderOptions(product.options)
  if (optionLines) lines.push(`\n— Options —\n${optionLines}`)

  const variantLines = renderVariants(variants, title, opts.includeCheckout)
  if (variantLines) lines.push(`\n— Variants —\n${variantLines}`)

  return lines.join('\n')
}

function renderOptions(options: unknown): string {
  if (!Array.isArray(options)) return ''
  const lines: string[] = []
  for (const option of options) {
    if (!isObject(option)) continue
    const name = asString(option.name)
    const values = Array.isArray(option.values)
      ? option.values.map((v) => (isObject(v) ? asString(v.label) : asString(v))).filter(Boolean)
      : []
    if (name && values.length) lines.push(`${name}: ${values.join(', ')}`)
  }
  return lines.join('\n')
}

function renderVariants(variants: JsonObject[], productTitle: string, includeCheckout: boolean): string {
  const lines: string[] = []
  for (const variant of variants) {
    const name = variantName(variant, productTitle)
    const id = shortId(asString(variant.id)) ?? asString(variant.id)
    if (name && id) lines.push(`${name} (${id})`)
    else if (name) lines.push(name)
    else if (id) lines.push(id)

    // Show UCP's checkout link as-is, with UTM appended. Never recreate it.
    // Only rendered for get_product; search/lookup omit it to stay compact.
    if (!includeCheckout) continue
    const checkoutUrl = asString(variant.checkout_url)
    if (checkoutUrl) lines.push(`Checkout: ${withUtm(checkoutUrl)}`)
  }
  return lines.join('\n')
}

// Build a variant's display name from its option selections, e.g.
// [{name:'Color',label:'Black'},{name:'Size',label:'6-12 months'}] -> "Black / 6-12 months".
// The catalog often sets `variant.title` to the product title, so prefer the
// option labels; only fall back to `variant.title` when it adds information
// (i.e. differs from the product title), then to the SKU.
function variantName(variant: JsonObject, productTitle: string): string | undefined {
  const options = Array.isArray(variant.options) ? variant.options : []
  const labels = options
    .map((opt) => (isObject(opt) ? asString(opt.label) ?? asString(opt.value) : asString(opt)))
    .filter((label): label is string => Boolean(label))
  if (labels.length) return labels.join(' / ')

  const title = asString(variant.title)
  if (title && title !== productTitle) return title
  return asString(variant.sku)
}

function renderMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  const notFound = messages
    .filter(isObject)
    .filter((m) => m.code === 'not_found')
    .map((m) => asString(m.content))
    .filter(Boolean)
  return notFound.length ? `_Not found: ${notFound.join(', ')}_` : ''
}

// Surface the UCP checkout `messages[]` array (warnings/errors/info such as
// final_sale, prop65, age_restricted, disclosures) into a clearly-labeled,
// human-readable block. The protocol requires `warning` content to be shown
// (and `presentation: "disclosure"` messages shown verbatim, non-dismissable),
// so we lift them out of the raw JSON blob where the agent can miss them.
// Returns '' when there are no messages.
export function renderCheckoutMessages(result: unknown): string {
  const messages = collectCheckoutMessages(result)
  if (!messages.length) return ''
  const lines = messages.map((m) => {
    const type = (asString(m.type) ?? 'message').toUpperCase()
    const code = asString(m.code)
    const content = asString(m.content)
    const meta: string[] = []
    const presentation = asString(m.presentation)
    const path = asString(m.path)
    const url = asString(m.url)
    if (presentation) meta.push(`presentation: ${presentation}`)
    if (path) meta.push(`path: ${path}`)
    if (url) meta.push(url)
    let line = `- [${type}${code ? ` ${code}` : ''}] ${content ?? ''}`.trimEnd()
    if (meta.length) line += ` (${meta.join('; ')})`
    return line
  })
  return ['## Checkout messages — MUST be shown to the user', ...lines].join('\n')
}

// Checkout messages may sit at the top level (`messages`) or nested under the
// returned checkout (`checkout.messages`). Collect both.
function collectCheckoutMessages(result: unknown): JsonObject[] {
  if (!isObject(result)) return []
  const direct = Array.isArray(result.messages) ? (result.messages as unknown[]) : []
  const checkout = isObject(result.checkout) ? (result.checkout as JsonObject) : undefined
  const nested = checkout && Array.isArray(checkout.messages) ? (checkout.messages as unknown[]) : []
  return [...direct, ...nested].filter(isObject)
}

function getStructuredContent(json: unknown): JsonObject | undefined {
  if (!isObject(json)) return undefined
  const result = isObject(json.result) ? (json.result as JsonObject) : undefined
  const structured = result && isObject(result.structuredContent) ? (result.structuredContent as JsonObject) : undefined
  return structured
}

function formatPrice(priceRange: unknown, fallback: unknown): string | undefined {
  if (isObject(priceRange)) {
    const min = formatMoney(priceRange.min)
    const max = formatMoney(priceRange.max)
    if (min && max && min !== max) return `${min}–${max}`
    if (min) return min
  }
  return formatMoney(fallback)
}

function formatMoney(money: unknown): string | undefined {
  if (!isObject(money)) return undefined
  const amount = typeof money.amount === 'number' ? money.amount : undefined
  const currency = asString(money.currency)
  if (amount === undefined) return undefined
  // Catalog amounts are in minor currency units.
  const major = amount / 100
  if (!currency) return `$${major.toFixed(2)}`
  // Render the currency's own symbol (£, €, $, …) instead of a hardcoded "$",
  // then append the ISO code to disambiguate (e.g. "£20.00 GBP", "$129.95 CAD").
  return `${formatCurrencyAmount(major, currency)} ${currency}`
}

function formatCurrencyAmount(major: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(major)
  } catch {
    // Unknown/invalid currency code: fall back to a plain amount.
    return major.toFixed(2)
  }
}

function formatRating(rating: unknown): string | undefined {
  if (!isObject(rating)) return undefined
  const value = typeof rating.value === 'number' ? rating.value : undefined
  if (value === undefined) return undefined
  const scaleMax = typeof rating.scale_max === 'number' ? rating.scale_max : 5
  const count = typeof rating.count === 'number' ? rating.count : undefined
  const base = `${value}/${scaleMax}`
  if (count === undefined) return base
  return `${base} (${count.toLocaleString('en-US')} review${count === 1 ? '' : 's'})`
}

function formatDescription(description: unknown): string | undefined {
  if (typeof description === 'string') return collapse(description)
  if (!isObject(description)) return undefined
  const plain = asString(description.plain)
  if (plain) return collapse(plain)
  const html = asString(description.html)
  if (html) return collapse(stripHtml(html))
  return undefined
}

function attributeLines(attributes: unknown): string[] {
  if (!Array.isArray(attributes)) return []
  const grouped = new Map<string, string[]>()
  for (const attr of attributes) {
    if (!isObject(attr)) continue
    const name = asString(attr.name)
    const value = asString(attr.value)
    if (!name || !value) continue
    const existing = grouped.get(name) ?? []
    if (!existing.includes(value)) existing.push(value)
    grouped.set(name, existing)
  }
  return [...grouped.entries()].map(([name, values]) => `${name}: ${values.join(', ')}`)
}

function firstMediaUrl(media: unknown): string | undefined {
  if (!Array.isArray(media)) return undefined
  for (const item of media) {
    if (isObject(item)) {
      const url = safeImageUrl(asString(item.url))
      if (url) return url
    }
  }
  return undefined
}

// Media URLs come from untrusted merchant catalog content, so only surface
// HTTPS URLs. Reject http:, file:, data:, javascript:, and any other scheme
// (per references/safety.md) so a malicious listing can't emit a dangerous or
// tracking link as a user-visible image.
function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

// top_features / tech_specs come back from the catalog as newline-delimited
// strings (one item per line), though older/compact payloads sometimes use a
// plain array. Handle both: split strings on newlines, map arrays through
// asString, and drop blanks.
function stringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value.map((v) => asString(v)).filter((v): v is string => Boolean(v))
}

// Reduce a GID like "gid://shopify/Shop/987654321" to its trailing id segment,
// and "gid://shopify/p/6J8JMOV0g1JeQNJlp3juMV" to the UPID. Non-GID strings are
// returned unchanged.
function shortId(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('gid://')) return value
  const segments = value.split('/').filter(Boolean)
  return segments[segments.length - 1]
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
