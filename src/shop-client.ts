import {
  ACCESS_TOKEN_ACCOUNT,
  CLIENT_ID,
  DEFAULT_COUNTRY,
  DEFAULT_PROFILE_URL,
  ACCESS_TOKEN_TOKEN_TYPE,
  GLOBAL_CATALOG_AUDIENCE,
  GLOBAL_CATALOG_MCP_URL,
  REFRESH_TOKEN_ACCOUNT,
  TOKEN_EXCHANGE_URL,
  UCP_PROFILE,
} from './constants.js'
import { ShopCliError } from './errors.js'
import { formBody, jsonHeaders, parseJsonResponse, parseTextResponse } from './http.js'
import { AuthClient } from './auth.js'
import { getCountry, getOrCreateDeviceId } from './storage.js'
import type { FetchLike, JsonObject, SecretStore } from './types.js'

export interface ShopCatalogClientOptions {
  fetch?: FetchLike
  store: SecretStore
  profileUrl?: string
  country?: string
  auth?: AuthClient
}

export interface CatalogSearchInput {
  query?: string
  like?: unknown[]
  limit?: number
  country?: string
  region?: string
  postalCode?: string
  currency?: string
  language?: string
  intent?: string
  minPrice?: number
  maxPrice?: number
  available?: boolean
  condition?: string[]
  shipsFrom?: string
  shipsTo?: { country: string; region?: string; postalCode?: string }
  shopIds?: string[]
  categories?: string[]
  view?: string
}

export interface CatalogLookupInput {
  ids: string[]
  country?: string
  currency?: string
  available?: boolean
  condition?: string[]
  shipsTo?: { country: string; region?: string; postalCode?: string }
  view?: string
}

export interface CatalogGetProductInput {
  id: string
  selected?: Array<{ name: string; label: string }>
  preferences?: string[]
  country?: string
  currency?: string
  available?: boolean
  condition?: string[]
  view?: string
}

export interface CheckoutCreateInput {
  shopDomain: string
  variantId?: string
  quantity?: number
  checkout?: JsonObject
  buyerIp?: string
}

export interface CheckoutUpdateInput {
  shopDomain: string
  checkoutId: string
  checkout: JsonObject
  buyerIp?: string
}

export interface CheckoutCompleteInput {
  shopDomain: string
  checkoutId: string
  // The payment instruments echoed back by create_checkout (response
  // `payment.instruments`). We re-send these verbatim, only selecting them and
  // injecting the credential token, so the instrument id matches the one the
  // merchant issued for this checkout session.
  instruments: JsonObject[]
  idempotencyKey: string
  buyerIp?: string
}

export interface OrderSearchInput {
  type: 'recent' | 'tracking' | 'order_info' | 'returns' | 'reorder'
  query?: string
  dateFrom?: string
  dateTo?: string
  cursor?: string
}

export class ShopCatalogClient {
  private readonly fetchImpl: FetchLike
  private readonly auth: AuthClient
  private readonly profileUrl: string
  // Explicit per-invocation country override (e.g. global --country). Undefined when
  // not explicitly set, so the stored preference (then DEFAULT_COUNTRY) is used instead.
  private readonly explicitCountry?: string
  private readonly ucpTokens = new Map<string, string>()
  // Cached global-catalog exchange JWT (session/in-memory only). Present only
  // when the buyer is signed in; absent means we search the catalog unauthenticated.
  private catalogToken?: string

  constructor(private readonly options: ShopCatalogClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.auth = options.auth ?? new AuthClient({ fetch: this.fetchImpl, store: options.store })
    this.profileUrl = options.profileUrl ?? DEFAULT_PROFILE_URL
    this.explicitCountry = options.country
  }

  async searchCatalog(input: CatalogSearchInput): Promise<unknown> {
    // search_catalog only enforces filters.ships_to when it matches
    // context.address_country; otherwise the destination filter is silently
    // ignored and products that don't ship to the destination leak through.
    // So for search, align the context country to the ships-to destination
    // when the buyer didn't explicitly choose one. (lookup_catalog and
    // get_product enforce ships_to regardless of context, and forcing context
    // on them hides otherwise-valid products, so they are left unaligned.)
    const catalog = await this.catalogInput(input, { alignCountryToShipsTo: true })
    if (!catalog.query && !catalog.like) {
      throw new ShopCliError('Search requires a query, --like-id, or --image')
    }
    return this.callCatalogMcp('search_catalog', { catalog })
  }

  async lookupCatalog(input: CatalogLookupInput): Promise<unknown> {
    if (input.ids.length === 0) throw new ShopCliError('At least one id is required')
    const catalog = await this.catalogInput(input)
    return this.callCatalogMcp('lookup_catalog', { catalog })
  }

  async getProduct(input: CatalogGetProductInput): Promise<unknown> {
    const catalog = await this.catalogInput(input)
    return this.callCatalogMcp('get_product', { catalog })
  }

  async createCheckout(input: CheckoutCreateInput): Promise<unknown> {
    const shopDomain = assertValidShopDomain(input.shopDomain)
    const token = await this.getUcpToken(shopDomain)
    const buyerIp = await this.getBuyerIp(input.buyerIp)
    const checkout: JsonObject = { ...(input.checkout ?? {}) }
    if (input.variantId) {
      checkout.line_items = [
        {
          quantity: input.quantity ?? 1,
          item: { id: normalizeVariantGid(input.variantId) },
        },
      ]
    }

    return unwrapMcpResult(await this.callShopMcp(shopDomain, 'create_checkout', { checkout }, token, buyerIp))
  }

  async updateCheckout(input: CheckoutUpdateInput): Promise<unknown> {
    const shopDomain = assertValidShopDomain(input.shopDomain)
    const token = await this.getUcpToken(shopDomain)
    const buyerIp = await this.getBuyerIp(input.buyerIp)
    return unwrapMcpResult(
      await this.callShopMcp(
        shopDomain,
        'update_checkout',
        {
          id: input.checkoutId,
          checkout: input.checkout,
        },
        token,
        buyerIp,
      ),
    )
  }

  async completeCheckout(input: CheckoutCompleteInput): Promise<unknown> {
    // State-changing: caller MUST have explicit user purchase intent (CLI enforces --confirm).
    const shopDomain = assertValidShopDomain(input.shopDomain)
    if (input.instruments.length === 0) {
      throw new ShopCliError(
        'complete_checkout requires the payment instruments from the create_checkout response (payment.instruments). None were provided.',
      )
    }
    const token = await this.getUcpToken(shopDomain)
    const buyerIp = await this.getBuyerIp(input.buyerIp)
    const result = unwrapMcpResult(
      await this.callShopMcp(
        shopDomain,
        'complete_checkout',
        {
          id: input.checkoutId,
          checkout: {
            payment: {
              // Echo the instruments create_checkout returned. The merchant keys
              // completion off the instrument id it issued, so we must re-send
              // that exact id (not a synthetic one) and set credential.token to
              // it. This mirrors the reference simulator's _select_instrument.
              instruments: input.instruments.map(selectInstrument),
            },
          },
        },
        token,
        buyerIp,
        {
          'idempotency-key': input.idempotencyKey,
        },
      ),
    )
    // Don't assume the charge went through: verify the returned checkout status.
    // complete_checkout echoes the checkout, which is only `completed` on a
    // successful purchase. Any other status (e.g. still `ready_for_complete`,
    // or a payment failure) means the order did NOT complete, so surface it as
    // an error with the full payload instead of returning a success-looking blob.
    assertCheckoutCompleted(result)
    return result
  }

  async searchOrders(input: OrderSearchInput): Promise<unknown> {
    if (input.type === 'recent' && input.query) throw new ShopCliError('recent order search does not accept query')
    if (input.type !== 'recent' && !input.query) throw new ShopCliError(`${input.type} order search requires query`)
    const accessToken = await this.requireAccessToken()
    const deviceId = await getOrCreateDeviceId(this.options.store)
    const params = new URLSearchParams({ type: input.type })
    if (input.query) params.set('query', input.query)
    if (input.dateFrom) params.set('dateFrom', input.dateFrom)
    if (input.dateTo) params.set('dateTo', input.dateTo)
    if (input.cursor) params.set('cursor', input.cursor)

    const response = await this.authenticatedShopFetch(`https://shop.app/agents/orderSearch?${params.toString()}`, {
      accessToken,
      deviceId,
      label: 'Search orders',
    })
    // The orderSearch endpoint responds with text/markdown, not JSON, so return
    // the markdown summary verbatim. (Parsing it as JSON silently dropped every
    // result and emitted an empty `{ orders: [] }`.)
    return parseTextResponse(response, 'Search orders', 'No matching orders found.')
  }

  async status(): Promise<unknown> {
    const accessToken = await this.auth.getValidAccessToken()
    if (!accessToken) return { authenticated: false }
    const user = await this.auth.validate(accessToken)
    return { authenticated: true, user }
  }

  async login(): Promise<unknown> {
    await this.auth.login()
    return this.status()
  }

  private async catalogInput(
    input: CatalogSearchInput | CatalogLookupInput | CatalogGetProductInput,
    opts: { alignCountryToShipsTo?: boolean } = {},
  ): Promise<JsonObject> {
    const shipsTo = 'shipsTo' in input ? input.shipsTo : undefined
    const shipsToCountry = shipsTo?.country
    // Precedence: per-command --country (input.country) > explicit global --country
    // (this.explicitCountry) > ships-to destination (search only) > stored
    // preference > DEFAULT_COUNTRY. The ships-to step is what makes search
    // honor the destination filter (see searchCatalog).
    const explicitCountry = input.country ?? this.explicitCountry
    const alignedToShipsTo = explicitCountry === undefined && opts.alignCountryToShipsTo ? shipsToCountry : undefined
    const country =
      explicitCountry ?? alignedToShipsTo ?? (await getCountry(this.options.store, DEFAULT_COUNTRY))
    const catalog: JsonObject = {}

    if ('query' in input && input.query) catalog.query = input.query
    // Re-attach the gid:// prefix that `shop search` strips for display, so the
    // short ids the agent copies out of search results round-trip back into
    // lookup/get-product/--like-id instead of 404ing. See normalizeCatalogId.
    if ('like' in input && input.like) catalog.like = normalizeLikeItems(input.like)
    if ('ids' in input) catalog.ids = input.ids.map(normalizeCatalogId)
    if ('id' in input) catalog.id = normalizeCatalogId(input.id)
    if ('selected' in input && input.selected) catalog.selected = input.selected
    if ('preferences' in input && input.preferences) catalog.preferences = input.preferences
    // Default to the compact response shape to trim the upstream payload; an
    // explicit --view always wins.
    catalog.view = ('view' in input && input.view) || 'compact'

    const context: JsonObject = { address_country: country }
    if ('region' in input && input.region) context.address_region = input.region
    if ('postalCode' in input && input.postalCode) context.postal_code = input.postalCode
    // When we aligned the context to the ships-to destination, propagate the
    // ships-to region/postal too (if the caller didn't set its own), since the
    // catalog enriches shipping eligibility from a matching context.
    if (alignedToShipsTo !== undefined && shipsTo) {
      if (!('region' in input && input.region) && shipsTo.region) context.address_region = shipsTo.region
      if (!('postalCode' in input && input.postalCode) && shipsTo.postalCode)
        context.postal_code = shipsTo.postalCode
    }
    if ('currency' in input && input.currency) context.currency = input.currency
    if ('language' in input && input.language) context.language = input.language
    if ('intent' in input && input.intent) context.intent = input.intent
    catalog.context = context

    const filters: JsonObject = {}
    if ('limit' in input && input.limit) catalog.pagination = { limit: input.limit }
    // Availability filter is tri-state:
    //   - property absent (direct client call without specifying) -> default to available-only
    //   - true/false -> restrict to available / unavailable respectively
    //   - present but undefined (the --include-unavailable signal) -> omit, returning both
    if ('available' in input) {
      if (input.available !== undefined) filters.available = input.available
    } else {
      filters.available = true
    }
    if ('minPrice' in input || 'maxPrice' in input) {
      const price: JsonObject = {}
      if ('minPrice' in input && input.minPrice !== undefined) price.min = input.minPrice
      if ('maxPrice' in input && input.maxPrice !== undefined) price.max = input.maxPrice
      filters.price = price
    }
    if ('condition' in input && input.condition?.length) filters.condition = input.condition
    if ('shipsFrom' in input && input.shipsFrom) filters.ships_from = { country: input.shipsFrom }
    if ('shipsTo' in input && input.shipsTo) {
      const shipsTo: JsonObject = { country: input.shipsTo.country }
      if (input.shipsTo.region) shipsTo.region = input.shipsTo.region
      if (input.shipsTo.postalCode) shipsTo.postal_code = input.shipsTo.postalCode
      filters.ships_to = shipsTo
    }
    if ('shopIds' in input && input.shopIds?.length) filters.shop_ids = input.shopIds
    if ('categories' in input && input.categories?.length) {
      filters.categories = input.categories.map((id) => ({ id }))
    }
    if (Object.keys(filters).length > 0) catalog.filters = filters

    return catalog
  }

  private async callMcp(
    endpoint: string,
    toolName: string,
    args: JsonObject,
    headers: Record<string, string> = {},
    meta: JsonObject = {},
  ): Promise<unknown> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: jsonHeaders(headers),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: toolName,
          arguments: {
            meta: {
              'ucp-agent': {
              profile: isCatalogTool(toolName) ? this.profileUrl : UCP_PROFILE,
              },
              ...meta,
            },
            ...args,
          },
        },
      }),
    })
    const json = await parseJsonResponse<JsonObject>(response, `Call ${toolName}`)
    if (json.error) throw new ShopCliError(`MCP ${toolName} returned an error`, { details: json.error })
    return json
  }

  // Global catalog read calls. When the buyer is signed in we attach an
  // authenticated catalog token; otherwise we fall back to an unauthenticated
  // request. Auth is handled here so callers never have to.
  private async callCatalogMcp(toolName: string, args: JsonObject): Promise<unknown> {
    const token = await this.getCatalogToken()
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    try {
      return await this.callMcp(GLOBAL_CATALOG_MCP_URL, toolName, args, headers)
    } catch (error) {
      // If the catalog token was rejected, drop it and retry once. On the
      // retry we re-mint (or, if re-mint fails, fall back to unauthenticated)
      // so a stale catalog token never blocks discovery.
      if (error instanceof ShopCliError && error.status === 401 && token) {
        this.catalogToken = undefined
        const fresh = await this.getCatalogToken()
        return this.callMcp(
          GLOBAL_CATALOG_MCP_URL,
          toolName,
          args,
          fresh ? { Authorization: `Bearer ${fresh}` } : {},
        )
      }
      throw error
    }
  }

  // Mint (and cache) a Global API token for authenticated global-catalog calls
  // when the buyer is signed in. Returns null when there is no usable access
  // token, so search stays available unauthenticated.
  //
  // Brokered RFC 8693 exchange: audience=api.shopify.com + requested_token_type
  // returns a Global API access_token that catalog.shopify.com accepts as a
  // Bearer. (Distinct from the per-merchant checkout exchange in getUcpToken,
  // which targets resource=https://{shop}/.) The buyer's catalog-search consent
  // scope rides along on the source token, so no explicit scope is requested.
  private async getCatalogToken(): Promise<string | null> {
    if (this.catalogToken) return this.catalogToken
    const accessToken = await this.requireAccessToken().catch(() => null)
    if (!accessToken) return null
    const response = await this.fetchImpl(TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: accessToken,
        subject_token_type: ACCESS_TOKEN_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TOKEN_TYPE,
        audience: GLOBAL_CATALOG_AUDIENCE,
        client_id: CLIENT_ID,
      }),
    })
    const json = await parseJsonResponse<{ access_token?: string }>(response, 'Fetch catalog token')
    if (!json.access_token) throw new ShopCliError('Catalog token response did not include access_token')
    this.catalogToken = json.access_token
    return this.catalogToken
  }

  private async callShopMcp(
    shopDomain: string,
    toolName: string,
    args: JsonObject,
    token: string,
    buyerIp: string,
    meta: JsonObject = {},
  ): Promise<unknown> {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Shopify-Buyer-Ip': buyerIp,
    }
    try {
      return await this.callMcp(`https://${shopDomain}/api/ucp/mcp`, toolName, args, headers, meta)
    } catch (error) {
      if (error instanceof ShopCliError && error.status === 401) {
        this.ucpTokens.delete(shopDomain)
        const freshToken = await this.getUcpToken(shopDomain)
        return this.callMcp(
          `https://${shopDomain}/api/ucp/mcp`,
          toolName,
          args,
          {
            Authorization: `Bearer ${freshToken}`,
            'Shopify-Buyer-Ip': buyerIp,
          },
          meta,
        )
      }
      if (error instanceof ShopCliError && error.status === 429) {
        await sleep(1000)
        return this.callMcp(`https://${shopDomain}/api/ucp/mcp`, toolName, args, headers, meta)
      }
      throw error
    }
  }

  private async authenticatedShopFetch(
    url: string,
    options: { accessToken: string; label: string; deviceId?: string },
  ): Promise<Response> {
    const buildInit = (accessToken: string): RequestInit => ({
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options.deviceId ? { 'x-device-id': options.deviceId } : {}),
      },
    })

    const first = await this.fetchImpl(url, buildInit(options.accessToken))
    if (first.status === 401) {
      const refreshed = await this.auth.refreshStoredToken()
      if (refreshed?.accessToken) return this.fetchImpl(url, buildInit(refreshed.accessToken))
    }
    if (first.status === 429) {
      await sleep(1000)
      return this.fetchImpl(url, buildInit(options.accessToken))
    }
    return first
  }

  private async getUcpToken(shopDomain: string): Promise<string> {
    const cached = this.ucpTokens.get(shopDomain)
    if (cached) return cached

    const accessToken = await this.requireAccessToken()
    const response = await this.fetchImpl('https://shop.app/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: accessToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        resource: `https://${shopDomain}/`,
        client_id: '5c733ab2-1903-400a-891e-7ba20c09e2a3',
      }),
    })
    const json = await parseJsonResponse<{ access_token?: string }>(response, 'Fetch checkout token')
    if (!json.access_token) throw new ShopCliError('Checkout token response did not include access_token')
    this.ucpTokens.set(shopDomain, json.access_token)
    return json.access_token
  }

  private async requireAccessToken(): Promise<string> {
    const valid = await this.auth.getValidAccessToken()
    if (valid) return valid
    const stored = await this.options.store.get(ACCESS_TOKEN_ACCOUNT)
    const refreshToken = await this.options.store.get(REFRESH_TOKEN_ACCOUNT)
    if (stored && !refreshToken) return stored
    throw new ShopCliError('Authentication required. Run `shop auth login` first.')
  }

  // Resolve the buyer's public IP for the merchant's Shopify-Buyer-Ip fraud/risk
  // checks, as any web checkout does. Prefers an explicit, user-provided --buyer-ip or
  // SHOP_BUYER_IP; the fallback reads the buyer's own IP from api.ipify.org.
  // Set either override to skip the network lookup entirely.
  private async getBuyerIp(override?: string): Promise<string> {
    const explicit = (override ?? process.env.SHOP_BUYER_IP ?? '').trim()
    if (explicit) return explicit

    let response: Response
    try {
      response = await this.fetchImpl('https://api.ipify.org?format=json')
    } catch (error) {
      throw new ShopCliError(
        'Could not determine the buyer public IP from api.ipify.org. Pass --buyer-ip or set SHOP_BUYER_IP.',
        { details: error instanceof Error ? error.message : error },
      )
    }
    const json = await parseJsonResponse<{ ip?: string }>(response, 'Fetch buyer public IP')
    if (!json.ip) {
      throw new ShopCliError(
        'Buyer public IP response did not include ip. Pass --buyer-ip or set SHOP_BUYER_IP.',
      )
    }
    return json.ip
  }
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

// Only ever transmit Shop authorization and payment material to a bare merchant
// hostname. Rejects schemes, paths, ports, credentials, whitespace, bare
// "localhost", and raw IP addresses so a malformed or injected --shop-domain
// cannot redirect a checkout (and its bearer token / buyer IP) elsewhere.
function assertValidShopDomain(domain: string): string {
  const normalized = (domain ?? '').trim().toLowerCase()
  if (
    !SHOP_DOMAIN_PATTERN.test(normalized) ||
    normalized === 'localhost' ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    throw new ShopCliError(
      `Invalid shop domain "${domain}". Provide a bare merchant hostname such as example.myshopify.com (no scheme, path, port, or IP).`,
    )
  }
  return normalized
}

// Confirm complete_checkout actually completed the purchase. The checkout is
// only `completed` on success; surface any other status (or a missing one) as
// an actionable error carrying the full payload so the caller doesn't treat an
// incomplete or failed checkout as a successful order.
function assertCheckoutCompleted(result: unknown): void {
  const status = isPlainObject(result) ? result.status : undefined
  if (status === 'completed') return
  throw new ShopCliError(
    `Checkout did not complete (status: ${typeof status === 'string' ? status : 'unknown'}). The purchase was not confirmed; do not retry without re-verifying the checkout.`,
    { details: result },
  )
}

// Prepare a create_checkout payment instrument for complete_checkout: keep every
// field the merchant returned (id, handler_id, type, display, ...), mark it
// selected, and set credential.token to the instrument's own id. The instrument
// id IS the checkout payment token; re-sending the exact id is what lets the
// merchant match the instrument to the session. Mirrors the reference
// simulator's _select_instrument.
function selectInstrument(instrument: JsonObject): JsonObject {
  const id = typeof instrument.id === 'string' ? instrument.id : ''
  const credential = isPlainObject(instrument.credential)
    ? instrument.credential
    : { type: 'shop_token' }
  return {
    ...instrument,
    selected: true,
    credential: { ...credential, token: id },
  }
}

function normalizeVariantGid(variantId: string): string {
  if (variantId.startsWith('gid://')) return variantId
  return `gid://shopify/ProductVariant/${variantId}`
}

// `shop search` renders catalog IDs in short form (the gid:// prefix stripped to
// save tokens): product UPIDs like "6J8JMOV0g1JeQNJlp3juMV" and numeric variant
// IDs like "50362300006715". lookup_catalog / get_product / --like-id require the
// full gid, so re-attach the prefix when the agent passes a short id back. The
// heuristic matches the two shapes search emits: an all-digits id is a variant
// (gid://shopify/ProductVariant/<id>); any other bare token is treated as a
// product UPID (gid://shopify/p/<upid>). Already-qualified gids (and anything we
// don't recognise) pass through untouched, so callers holding a full gid — or a
// numeric legacy gid://shopify/Product/<id> they pasted whole — are unaffected.
export function normalizeCatalogId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed || trimmed.startsWith('gid://')) return trimmed
  if (/^\d+$/.test(trimmed)) return `gid://shopify/ProductVariant/${trimmed}`
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return `gid://shopify/p/${trimmed}`
  return trimmed
}

// Normalize the `id` of each catalog `like` reference (from --like-id) while
// leaving image references and any other shape untouched.
function normalizeLikeItems(like: unknown[]): unknown[] {
  return like.map((item) =>
    isPlainObject(item) && typeof item.id === 'string'
      ? { ...item, id: normalizeCatalogId(item.id) }
      : item,
  )
}

function isCatalogTool(toolName: string): boolean {
  return toolName === 'search_catalog' || toolName === 'lookup_catalog' || toolName === 'get_product'
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Unwrap the MCP JSON-RPC envelope down to the actual tool payload.
//
// An MCP tool result looks like:
//   { jsonrpc, id, result: { content: [{ type: 'text', text: '<json string>' }], structuredContent: {...}, isError } }
//
// The same payload is present twice — once as a stringified `content[].text`
// blob and once as parsed `structuredContent`. We return `structuredContent`
// when available, otherwise parse the first text block, and only fall back to
// the raw envelope if neither is usable.
function unwrapMcpResult(json: unknown): unknown {
  if (!isPlainObject(json)) return json
  const result = isPlainObject(json.result) ? json.result : undefined
  if (!result) return json

  if (isPlainObject(result.structuredContent)) return result.structuredContent

  if (Array.isArray(result.content)) {
    const textBlock = result.content.find((block) => isPlainObject(block) && block.type === 'text')
    if (isPlainObject(textBlock) && typeof textBlock.text === 'string') {
      try {
        return JSON.parse(textBlock.text)
      } catch {
        return textBlock.text
      }
    }
  }

  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
