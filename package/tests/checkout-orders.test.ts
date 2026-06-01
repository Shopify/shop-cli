import { describe, expect, it, vi } from 'vitest'

import {
  ACCESS_TOKEN_ACCOUNT,
  DEVICE_ID_ACCOUNT,
  REFRESH_TOKEN_ACCOUNT,
} from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import {
  createFetchMock,
  createStore,
  emptyResponse,
  jsonResponse,
  markdownResponse,
  readJsonBody,
  stdinFrom,
} from './test-utils.js'

describe('checkout and orders', () => {
  it('creates checkout using token exchange and buyer ip', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [REFRESH_TOKEN_ACCOUNT]: 'refresh',
    })
    const bodies: unknown[] = []
    const urls: string[] = []
    const fetchMock = createFetchMock(async (url, init) => {
      urls.push(url)
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      bodies.push(await readJsonBody(init))
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer ucp-jwt',
        'Shopify-Buyer-Ip': '203.0.113.10',
      })
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ready_for_complete' } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.createCheckout({
      shopDomain: 'example.myshopify.com',
      variantId: '123',
      quantity: 2,
      checkout: { email: 'buyer@example.com' },
    })

    expect(urls).toContain('https://shop.app/oauth/token')
    expect(urls).toContain('https://example.myshopify.com/api/ucp/mcp')
    expect(bodies[0]).toMatchObject({
      params: {
        name: 'create_checkout',
        arguments: {
          checkout: {
            email: 'buyer@example.com',
            line_items: [
              {
                quantity: 2,
                item: { id: 'gid://shopify/ProductVariant/123' },
              },
            ],
          },
        },
      },
    })
  })

  it('unwraps the MCP envelope and returns the checkout payload, not the raw frame', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const checkout = { id: 'gid://shopify/Checkout/abc', status: 'ready_for_complete', currency: 'GBP' }
    const fetchMock = createFetchMock(async (url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      // Real UCP responses carry the payload twice: as a stringified text block
      // and as structuredContent. We should surface structuredContent only.
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify(checkout) }],
          structuredContent: checkout,
          isError: false,
        },
      })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    const result = await client.createCheckout({ shopDomain: 'example.myshopify.com', variantId: '123' })

    expect(result).toEqual(checkout)
  })

  it('falls back to parsing the text content block when structuredContent is absent', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const checkout = { id: 'gid://shopify/Checkout/def', status: 'ready_for_complete' }
    const fetchMock = createFetchMock(async (url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(checkout) }], isError: false },
      })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    const result = await client.createCheckout({ shopDomain: 'example.myshopify.com', variantId: '123' })

    expect(result).toEqual(checkout)
  })

  it('creates checkout from stdin checkout JSON without requiring a variant id', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    let createBody: unknown
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      createBody = await readJsonBody(init)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ready_for_complete' } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.createCheckout({
      shopDomain: 'example.myshopify.com',
      checkout: { cart_id: 'cart-1', line_items: [] },
    })

    expect(createBody).toMatchObject({
      params: {
        name: 'create_checkout',
        arguments: {
          checkout: {
            cart_id: 'cart-1',
            line_items: [],
          },
        },
      },
    })
  })

  it('updates checkout details', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    let updateBody: unknown
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      updateBody = await readJsonBody(init)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ready_for_complete' } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.updateCheckout({
      shopDomain: 'example.myshopify.com',
      checkoutId: 'checkout-1',
      checkout: { email: 'buyer@example.com' },
    })

    expect(updateBody).toMatchObject({
      params: {
        name: 'update_checkout',
        arguments: {
          id: 'checkout-1',
          checkout: { email: 'buyer@example.com' },
        },
      },
    })
  })

  it('completes checkout with current payment token and idempotency key', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    let completeBody: unknown
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      completeBody = await readJsonBody(init)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'completed' } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.completeCheckout({
      shopDomain: 'example.myshopify.com',
      checkoutId: 'checkout-1',
      paymentToken: 'pay-token',
      idempotencyKey: 'intent-1',
    })

    expect(completeBody).toMatchObject({
      params: {
        name: 'complete_checkout',
        arguments: {
          meta: {
            'idempotency-key': 'intent-1',
          },
          id: 'checkout-1',
          checkout: {
            payment: {
              instruments: [
                {
                  credential: {
                    type: 'shop_token',
                    token: 'pay-token',
                  },
                },
              ],
            },
          },
        },
      },
    })
  })

  it('searches orders with bearer token and device id', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    const fetchMock = createFetchMock((url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      expect(url).toContain('https://shop.app/agents/orderSearch?')
      expect(url).toContain('type=tracking')
      expect(url).toContain('query=shoes')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer access',
        'x-device-id': 'device-1',
      })
      return markdownResponse('## Summary\n\nYour orders include shoes at Acme.')
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.searchOrders({ type: 'tracking', query: 'shoes' })).resolves.toEqual(
      '## Summary\n\nYour orders include shoes at Acme.',
    )
  })

  it('supports every original order search type', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    const urls: string[] = []
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      urls.push(url)
      return markdownResponse('## Summary\n\nYour orders.')
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.searchOrders({ type: 'recent' })
    await client.searchOrders({ type: 'tracking', query: 'shoes' })
    await client.searchOrders({ type: 'order_info', query: 'shoes', dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    await client.searchOrders({ type: 'returns', query: 'jacket' })
    await client.searchOrders({ type: 'reorder', query: 'coffee', cursor: 'cursor-1' })

    expect(urls).toHaveLength(5)
    expect(urls[0]).toContain('type=recent')
    expect(urls[1]).toContain('type=tracking')
    expect(urls[2]).toContain('type=order_info')
    expect(urls[2]).toContain('dateFrom=2026-01-01')
    expect(urls[2]).toContain('dateTo=2026-01-31')
    expect(urls[3]).toContain('type=returns')
    expect(urls[4]).toContain('type=reorder')
    expect(urls[4]).toContain('cursor=cursor-1')
  })

  it('refreshes and retries order search on 401', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'old-access',
      [REFRESH_TOKEN_ACCOUNT]: 'refresh',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    let orderCalls = 0
    const fetchMock = createFetchMock((url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
      if (url.endsWith('/oauth/token')) return jsonResponse({ access_token: 'new-access', refresh_token: 'refresh' })
      if (url.includes('/agents/orderSearch')) {
        orderCalls += 1
        expect(init.headers).toMatchObject({
          Authorization: 'Bearer new-access',
          'x-device-id': 'device-1',
        })
        return orderCalls === 1
          ? jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
          : markdownResponse('## Summary\n\nOrder order-1 in_transit.')
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.searchOrders({ type: 'tracking', query: 'shoes' })).resolves.toEqual(
      '## Summary\n\nOrder order-1 in_transit.',
    )
  })

  it('treats an empty 200 order search response as no orders', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url.includes('/agents/orderSearch')) return emptyResponse()
      throw new Error(`Unexpected URL ${url}`)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await expect(client.searchOrders({ type: 'recent' })).resolves.toEqual('No matching orders found.')
  })

  it('validates order search query rules', async () => {
    const client = new ShopCatalogClient({
      fetch: createFetchMock(() => jsonResponse({})),
      store: createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' }),
    })

    await expect(client.searchOrders({ type: 'recent', query: 'nope' })).rejects.toThrow('recent')
    await expect(client.searchOrders({ type: 'returns' })).rejects.toThrow('requires query')
  })

  it('supports checkout and orders CLI commands', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'access',
      [DEVICE_ID_ACCOUNT]: 'device-1',
    })
    const names: string[] = []
    const urls: string[] = []
    const fetchMock = createFetchMock(async (url, init) => {
      urls.push(url)
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      if (url.includes('/agents/orderSearch')) return markdownResponse('## Summary\n\nYour orders.')
      const body = (await readJsonBody(init)) as { params: { name: string } }
      names.push(body.params.name)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
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

    await createProgram({ ...base, stdin: stdinFrom('{"email":"buyer@example.com"}') }).parseAsync([
      'node',
      'shop',
      'checkout',
      'create',
      '--shop-domain',
      'example.myshopify.com',
      '--variant-id',
      '123',
      '--checkout-stdin',
    ])
    await createProgram({ ...base, stdin: stdinFrom('{"cart_id":"cart-1","line_items":[]}') }).parseAsync([
      'node',
      'shop',
      'checkout',
      'create',
      '--shop-domain',
      'example.myshopify.com',
      '--checkout-stdin',
    ])
    await createProgram({ ...base, stdin: stdinFrom('{"email":"buyer2@example.com"}') }).parseAsync([
      'node',
      'shop',
      'checkout',
      'update',
      '--shop-domain',
      'example.myshopify.com',
      '--checkout-id',
      'checkout-1',
      '--checkout-stdin',
    ])
    await createProgram({ ...base, stdin: stdinFrom('payment-token') }).parseAsync([
      'node',
      'shop',
      'checkout',
      'complete',
      '--shop-domain',
      'example.myshopify.com',
      '--checkout-id',
      'checkout-1',
      '--payment-token-stdin',
      '--idempotency-key',
      'intent-1',
      '--confirm',
    ])
    await createProgram(base).parseAsync(['node', 'shop', 'orders', 'search', '--type', 'recent'])
    await createProgram(base).parseAsync(['node', 'shop', 'orders', 'search', '--type', 'returns', '--query', 'jacket'])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(names).toEqual(['create_checkout', 'create_checkout', 'update_checkout', 'complete_checkout'])
  })

  it('refuses to complete checkout without --confirm', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const names: string[] = []
    const fetchMock = createFetchMock(async (url, init) => {
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
      const body = (await readJsonBody(init)) as { params: { name: string } }
      names.push(body.params.name)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
    })
    const exit = ((code: number) => {
      throw new Error(`exit ${code}`)
    }) as never

    await expect(
      createProgram({ fetch: fetchMock, store, stdout, stderr, exit, stdin: stdinFrom('payment-token') }).parseAsync([
        'node',
        'shop',
        'checkout',
        'complete',
        '--shop-domain',
        'example.myshopify.com',
        '--checkout-id',
        'checkout-1',
        '--payment-token-stdin',
        '--idempotency-key',
        'intent-1',
      ]),
    ).rejects.toThrow('exit 1')

    expect(names).not.toContain('complete_checkout')
    expect(stderr.write).toHaveBeenCalled()
  })

  it('uses an explicit buyer IP override instead of calling api.ipify.org', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const urls: string[] = []
    const fetchMock = createFetchMock(async (url) => {
      urls.push(url)
      if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
      if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
      if (url === 'https://api.ipify.org?format=json') throw new Error('ipify should not be called')
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ready_for_complete' } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store })

    await client.createCheckout({
      shopDomain: 'example.myshopify.com',
      variantId: '123',
      buyerIp: '198.51.100.7',
    })

    expect(urls).not.toContain('https://api.ipify.org?format=json')
    expect(urls).toContain('https://example.myshopify.com/api/ucp/mcp')
  })

  it('rejects checkout against a non-merchant shop domain', async () => {
    const client = new ShopCatalogClient({
      fetch: createFetchMock(() => jsonResponse({})),
      store: createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' }),
    })

    for (const bad of ['https://evil.example/api', 'evil.example/path', 'localhost', '127.0.0.1']) {
      await expect(
        client.completeCheckout({
          shopDomain: bad,
          checkoutId: 'checkout-1',
          paymentToken: 'pay-token',
          idempotencyKey: 'intent-1',
        }),
      ).rejects.toThrow('Invalid shop domain')
    }
  })
})
