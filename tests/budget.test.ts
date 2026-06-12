import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import { ACCESS_TOKEN_ACCOUNT, DEVICE_ID_ACCOUNT, REFRESH_TOKEN_ACCOUNT } from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import { createFetchMock, createStore, emptyResponse, jsonResponse } from './test-utils.js'

const PAYMENT_TOKENS_URL = 'https://shop.app/pay/agents/payment_tokens'

describe('auth budget', () => {
  it('summarizes a flat budget response (token + amounts on the root)', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access', [DEVICE_ID_ACCOUNT]: 'device-1' })
    const fetchMock = createFetchMock((url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) {
        expect(init.headers).toMatchObject({ Authorization: 'Bearer access', 'x-device-id': 'device-1' })
        return jsonResponse({ token: 'shop_secret', limit: 50000, remaining_amount: 30000, currency: 'USD' })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.budget()).resolves.toEqual({
      available: true,
      limit: 50000,
      remaining_amount: 30000,
      currency: 'USD',
      units: 'minor',
    })
  })

  it('parses the authoritative payment_tokens[].display payload shape', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) {
        return jsonResponse({
          payment_tokens: [
            {
              id: 'shop_secret',
              default_currency_code: 'USD',
              display: { limit: 10000, remaining_amount: 5750, renewal_type: 'monthly', renews_at: '2026-05-01T00:00:00Z' },
            },
          ],
          has_more: false,
          next_cursor: null,
        })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.budget()).resolves.toEqual({
      available: true,
      limit: 10000,
      remaining_amount: 5750,
      currency: 'USD',
      renewal_type: 'monthly',
      renews_at: '2026-05-01T00:00:00Z',
      units: 'minor',
    })
  })

  it('reports available: false when no token is present', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) return jsonResponse({ payment_tokens: [] })
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    const result = (await client.budget()) as Record<string, unknown>
    expect(result.available).toBe(false)
    expect(result).toHaveProperty('message')
  })

  it('treats an empty 200 response as no budget', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) return emptyResponse()
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect((client.budget() as Promise<Record<string, unknown>>).then((r) => r.available)).resolves.toBe(false)
  })

  it('maps a 403 invalid_scope to available: false with re-auth guidance (not a hard error)', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) {
        return jsonResponse(
          { messages: [{ type: 'error', code: 'invalid_scope', content: 'Access token does not have the required scope.' }] },
          { status: 403 },
        )
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    const result = (await client.budget()) as Record<string, unknown>
    expect(result.available).toBe(false)
    expect(result.reason).toBe('missing_payment_scope')
    expect(result).toHaveProperty('message')
  })

  it('returns authenticated: false when signed out', async () => {
    const store = createStore()
    const fetchMock = createFetchMock(() => {
      throw new Error('budget should not hit the network when signed out')
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.budget()).resolves.toEqual({ authenticated: false })
  })

  it('refreshes and retries on 401', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'old-access',
      [REFRESH_TOKEN_ACCOUNT]: 'refresh',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    let budgetCalls = 0
    const fetchMock = createFetchMock((url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
      if (url.endsWith('/oauth/token')) return jsonResponse({ access_token: 'new-access', refresh_token: 'refresh' })
      if (url === PAYMENT_TOKENS_URL) {
        budgetCalls += 1
        expect(init.headers).toMatchObject({ Authorization: 'Bearer new-access' })
        return budgetCalls === 1
          ? jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
          : jsonResponse({ token: 'shop_secret', remaining_amount: 12345 })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.budget()).resolves.toEqual({
      available: true,
      remaining_amount: 12345,
      units: 'minor',
    })
  })

  it('exposes a `shop auth budget` CLI command', async () => {
    const { createProgram } = await import('../src/cli.js')
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access', [DEVICE_ID_ACCOUNT]: 'device-1' })
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === PAYMENT_TOKENS_URL) return jsonResponse({ token: 'shop_secret', remaining_amount: 4200, currency: 'USD' })
      throw new Error(`Unexpected URL ${url}`)
    })

    await createProgram({
      fetch: fetchMock,
      store,
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', 'auth', 'budget'])

    expect(stdout.write).toHaveBeenLastCalledWith(expect.stringContaining('"remaining_amount": 4200'))
    expect(stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('shop_secret'))
  })
})
