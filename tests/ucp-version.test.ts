import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import {
  ACCESS_TOKEN_ACCOUNT,
  DEFAULT_PROFILE_URL,
  GLOBAL_CATALOG_MCP_URL,
  PAYMENT_TOKENS_URL,
  UCP_PROFILE,
  UCP_VERSION,
} from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import { createFetchMock, createStore, jsonResponse, readJsonBody } from './test-utils.js'

const MERCHANT_MCP_URL = 'https://example.myshopify.com/api/ucp/mcp'
const CUSTOM_PROFILE_URL = 'https://agent.example.com/ucp/profile.json'

type McpBody = { params: { arguments: { meta?: { 'ucp-agent'?: { profile?: string } } } } }

function profileOf(body: unknown): string | undefined {
  return (body as McpBody).params.arguments.meta?.['ucp-agent']?.profile
}

// Merchant checkout calls also hit auth + buyer-ip endpoints before the MCP
// call; answer those and record only the profile sent to the merchant.
function merchantFetchMock(profiles: Array<string | undefined>) {
  return createFetchMock(async (url, init) => {
    if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
    if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
    if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
    if (url === PAYMENT_TOKENS_URL) return jsonResponse({ payment_tokens: [] })
    if (url === MERCHANT_MCP_URL) {
      profiles.push(profileOf(await readJsonBody(init)))
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ready_for_complete' } } })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
}

describe('UCP release pinning', () => {
  it('pins both agent profiles to the 2026-08-25 release', () => {
    expect(UCP_VERSION).toBe('2026-08-25')
    expect(DEFAULT_PROFILE_URL).toBe(
      'https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json',
    )
    expect(UCP_PROFILE).toBe('https://shopify.dev/ucp/agent-profiles/2026-08-25/personal_agent.json')
  })

  it('sends the valid-with-capabilities profile on every global catalog call', async () => {
    const profiles: Array<string | undefined> = []
    const fetchMock = createFetchMock(async (url, init) => {
      expect(url).toBe(GLOBAL_CATALOG_MCP_URL)
      profiles.push(profileOf(await readJsonBody(init)))
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'boots', country: 'US' })
    await client.lookupCatalog({ ids: ['gid://shopify/ProductVariant/1'] })
    await client.getProduct({ id: 'gid://shopify/p/abc' })

    expect(profiles).toEqual([DEFAULT_PROFILE_URL, DEFAULT_PROFILE_URL, DEFAULT_PROFILE_URL])
    for (const profile of profiles) expect(profile).toContain('/2026-08-25/')
  })

  it('sends the personal_agent profile on merchant checkout calls', async () => {
    const profiles: Array<string | undefined> = []
    const client = new ShopCatalogClient({
      fetch: merchantFetchMock(profiles),
      store: createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' }),
    })

    await client.createCheckout({
      shopDomain: 'example.myshopify.com',
      variantId: '123',
      quantity: 1,
      checkout: { email: 'buyer@example.com' },
    })
    await client.updateCheckout({
      shopDomain: 'example.myshopify.com',
      checkoutId: 'checkout-1',
      checkout: { email: 'buyer@example.com' },
    })

    expect(profiles).toEqual([UCP_PROFILE, UCP_PROFILE])
    for (const profile of profiles) expect(profile).toContain('/2026-08-25/')
  })

  it('a custom profileUrl overrides the catalog profile but never the checkout profile', async () => {
    const catalogProfiles: Array<string | undefined> = []
    const catalogFetch = createFetchMock(async (_url, init) => {
      catalogProfiles.push(profileOf(await readJsonBody(init)))
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    await new ShopCatalogClient({
      fetch: catalogFetch,
      store: createStore(),
      profileUrl: CUSTOM_PROFILE_URL,
    }).searchCatalog({ query: 'boots', country: 'US' })
    expect(catalogProfiles).toEqual([CUSTOM_PROFILE_URL])

    const checkoutProfiles: Array<string | undefined> = []
    await new ShopCatalogClient({
      fetch: merchantFetchMock(checkoutProfiles),
      store: createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' }),
      profileUrl: CUSTOM_PROFILE_URL,
    }).createCheckout({
      shopDomain: 'example.myshopify.com',
      variantId: '123',
      quantity: 1,
      checkout: { email: 'buyer@example.com' },
    })
    expect(checkoutProfiles).toEqual([UCP_PROFILE])
  })

  it('CLI: --profile-url is forwarded to global catalog searches', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const profiles: Array<string | undefined> = []
    const fetchMock = createFetchMock(async (url, init) => {
      expect(url).toBe(GLOBAL_CATALOG_MCP_URL)
      profiles.push(profileOf(await readJsonBody(init)))
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const base = {
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }

    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots'])
    await createProgram(base).parseAsync(['node', 'shop', '--profile-url', CUSTOM_PROFILE_URL, 'search', 'boots'])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(profiles).toEqual([DEFAULT_PROFILE_URL, CUSTOM_PROFILE_URL])
  })
})
