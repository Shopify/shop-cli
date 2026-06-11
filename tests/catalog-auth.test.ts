import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import {
  ACCESS_TOKEN_ACCOUNT,
  GLOBAL_CATALOG_MCP_URL,
  REFRESH_TOKEN_ACCOUNT,
  TOKEN_EXCHANGE_URL,
} from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import { createFetchMock, createStore, jsonResponse, readJsonBody } from './test-utils.js'

// Parse a form-urlencoded request body (the token-exchange uses form encoding).
function readFormBody(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body ?? ''))
}

const CATALOG_AUDIENCE = 'api.shopify.com'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

describe('authenticated global catalog', () => {
  it('brokers the access token into a Global API token and sends it as a Bearer on search', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [REFRESH_TOKEN_ACCOUNT]: 'refresh',
    })
    const urls: string[] = []
    let exchangeBody: URLSearchParams | undefined
    let mcpAuth: string | undefined
    const fetchMock = createFetchMock(async (url, init) => {
      urls.push(url)
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === TOKEN_EXCHANGE_URL) {
        exchangeBody = readFormBody(init)
        return jsonResponse({ access_token: 'catalog-jwt' })
      }
      if (url === GLOBAL_CATALOG_MCP_URL) {
        mcpAuth = (init.headers as Record<string, string>)?.Authorization
        return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.searchCatalog({ query: 'trail running shoes', country: 'US' })

    // The brokered token exchange actually happened, targeting the Global API
    // trust domain (audience=api.shopify.com) and requesting an access_token.
    expect(urls).toContain(TOKEN_EXCHANGE_URL)
    expect(exchangeBody?.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange')
    expect(exchangeBody?.get('subject_token')).toBe('access')
    expect(exchangeBody?.get('subject_token_type')).toBe(ACCESS_TOKEN_TYPE)
    expect(exchangeBody?.get('requested_token_type')).toBe(ACCESS_TOKEN_TYPE)
    expect(exchangeBody?.get('audience')).toBe(CATALOG_AUDIENCE)
    // The exchange must NOT use the per-merchant checkout shape (resource=...).
    expect(exchangeBody?.get('resource')).toBe(null)
    // ...and the minted Global API token was attached to the global catalog MCP call.
    expect(mcpAuth).toBe('Bearer catalog-jwt')
  })

  it('searches unauthenticated (no exchange, no Authorization) when not signed in', async () => {
    const urls: string[] = []
    let mcpHadAuth = false
    const fetchMock = createFetchMock(async (url, init) => {
      urls.push(url)
      if (url === GLOBAL_CATALOG_MCP_URL) {
        mcpHadAuth = Boolean((init.headers as Record<string, string>)?.Authorization)
        return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'trail running shoes', country: 'US' })

    expect(urls).not.toContain(TOKEN_EXCHANGE_URL)
    expect(urls).toEqual([GLOBAL_CATALOG_MCP_URL])
    expect(mcpHadAuth).toBe(false)
  })

  it('reuses the catalog token across catalog calls (mints once)', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    let exchanges = 0
    const authHeaders: Array<string | undefined> = []
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === TOKEN_EXCHANGE_URL) {
        exchanges += 1
        return jsonResponse({ access_token: 'catalog-jwt' })
      }
      authHeaders.push((init.headers as Record<string, string>)?.Authorization)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.searchCatalog({ query: 'boots' })
    await client.lookupCatalog({ ids: ['gid://shopify/ProductVariant/1'] })
    await client.getProduct({ id: 'gid://shopify/p/abc' })

    expect(exchanges).toBe(1)
    expect(authHeaders).toEqual(['Bearer catalog-jwt', 'Bearer catalog-jwt', 'Bearer catalog-jwt'])
  })

  it('drops a rejected catalog token, re-mints, and retries once on 401', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    let exchanges = 0
    let mcpCalls = 0
    const tokens: Array<string | undefined> = []
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === TOKEN_EXCHANGE_URL) {
        exchanges += 1
        return jsonResponse({ access_token: exchanges === 1 ? 'stale-jwt' : 'fresh-jwt' })
      }
      mcpCalls += 1
      tokens.push((init.headers as Record<string, string>)?.Authorization)
      if (mcpCalls === 1) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.searchCatalog({ query: 'boots' })

    expect(exchanges).toBe(2)
    expect(tokens).toEqual(['Bearer stale-jwt', 'Bearer fresh-jwt'])
  })

  it('CLI: signing in makes subsequent searches authenticated against the global catalog', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const store = createStore()
    let mcpAuth: string | undefined
    let tokenPolls = 0
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) {
        return tokenPolls > 0
          ? jsonResponse({ sub: 'user-1', email: 'buyer@example.com' })
          : jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      if (url === 'https://accounts.shop.app/oauth/device') {
        return jsonResponse({
          device_code: 'device-code',
          user_code: 'ABCD',
          verification_uri_complete: 'https://shop.app/device',
          expires_in: 60,
          interval: 1,
        })
      }
      if (url === 'https://accounts.shop.app/oauth/token') {
        tokenPolls += 1
        return jsonResponse({ access_token: 'access', refresh_token: 'refresh' })
      }
      if (url === TOKEN_EXCHANGE_URL) return jsonResponse({ access_token: 'catalog-jwt' })
      if (url === GLOBAL_CATALOG_MCP_URL) {
        mcpAuth = (init.headers as Record<string, string>)?.Authorization
        return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const base = {
      fetch: fetchMock,
      store,
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }

    await createProgram(base).parseAsync(['node', 'shop', 'auth', 'login', '--device-name', 'Openclaw'])
    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots'])

    expect(mcpAuth).toBe('Bearer catalog-jwt')
  })
})
