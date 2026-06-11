import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import { AGENT_SOURCE, AGENT_SOURCE_HEADER, COUNTRY_ACCOUNT, GLOBAL_CATALOG_MCP_URL } from '../src/constants.js'
import { ShopCatalogClient, normalizeCatalogId } from '../src/shop-client.js'
import { createFetchMock, createStore, jsonResponse, readJsonBody } from './test-utils.js'

describe('global catalog', () => {
  it('searches via the Global Catalog MCP endpoint', async () => {
    const bodies: unknown[] = []
    const fetchMock = createFetchMock(async (url, init) => {
      expect(url).toBe(GLOBAL_CATALOG_MCP_URL)
      bodies.push(await readJsonBody(init))
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({
      query: 'wireless headphones',
      limit: 7,
      maxPrice: 10000,
      country: 'US',
      condition: ['new'],
      shipsTo: { country: 'CA' },
    })

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'search_catalog',
        arguments: {
          catalog: {
            query: 'wireless headphones',
            view: 'compact',
            pagination: { limit: 7 },
            context: { address_country: 'US' },
            filters: {
              available: true,
              price: { max: 10000 },
              condition: ['new'],
              ships_to: { country: 'CA' },
            },
          },
        },
      },
    })
  })

  it('sends ships_from as a list of origin objects', async () => {
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'coffee mug', country: 'US', shipsFrom: ['US', 'CA'] })

    expect(body?.params.arguments.catalog.filters?.ships_from).toEqual([{ country: 'US' }, { country: 'CA' }])
  })

  it('forwards a pagination cursor alongside the limit', async () => {
    let body: { params: { arguments: { catalog: { pagination?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'coffee mug', country: 'US', limit: 8, cursor: 'CURSOR_ABC' })

    expect(body?.params.arguments.catalog.pagination).toEqual({ limit: 8, cursor: 'CURSOR_ABC' })
  })

  it('identifies the CLI as the caller via the agent-source header', async () => {
    let headers: Record<string, string> | undefined
    const fetchMock = createFetchMock(async (url, init) => {
      expect(url).toBe(GLOBAL_CATALOG_MCP_URL)
      headers = init.headers as Record<string, string>
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'wireless headphones', country: 'US' })

    expect(headers?.[AGENT_SOURCE_HEADER]).toBe(AGENT_SOURCE)
  })

  it('maps color, size, and gender into a single filters.attributes array', async () => {
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({
      query: 'tshirt',
      country: 'US',
      color: ['White', 'Blue'],
      size: ['M'],
      gender: ['Female'],
    })

    // Values within an attribute combine with OR; the three attributes combine with AND.
    expect(body?.params.arguments.catalog.filters?.attributes).toEqual([
      { name: 'Color', values: ['White', 'Blue'] },
      { name: 'Size', values: ['M'] },
      { name: 'Target gender', values: ['Female'] },
    ])
  })

  it('only emits attribute entries for the filters that were provided', async () => {
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'tee', country: 'US', color: ['Red'] })

    expect(body?.params.arguments.catalog.filters?.attributes).toEqual([{ name: 'Color', values: ['Red'] }])
  })

  it('omits filters.attributes entirely when no attribute filter is set', async () => {
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'tee', country: 'US' })

    expect(body?.params.arguments.catalog.filters?.attributes).toBeUndefined()
  })

  it('does not send ships_to unless explicitly requested', async () => {
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'wireless headphones', country: 'US' })

    expect(body?.params.arguments.catalog.filters?.ships_to).toBeUndefined()
  })

  it('aligns search context.address_country to --ships-to when no country is given', async () => {
    // search_catalog only enforces ships_to when it matches address_country, so
    // the CLI must localize the context to the ships-to destination by default.
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown>; filters?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'boys shoes', shipsTo: { country: 'GB' } })

    expect(body?.params.arguments.catalog.context?.address_country).toBe('GB')
    expect(body?.params.arguments.catalog.filters?.ships_to).toEqual({ country: 'GB' })
  })

  it('does not let --ships-to override an explicit --country on search', async () => {
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'boys shoes', country: 'US', shipsTo: { country: 'GB' } })

    expect(body?.params.arguments.catalog.context?.address_country).toBe('US')
  })

  it('ships-to alignment beats a stored country preference on search', async () => {
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore({ [COUNTRY_ACCOUNT]: 'US' }) })

    await client.searchCatalog({ query: 'boys shoes', shipsTo: { country: 'GB' } })

    expect(body?.params.arguments.catalog.context?.address_country).toBe('GB')
  })

  it('propagates ships-to region/postal into the aligned search context', async () => {
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ query: 'boys shoes', shipsTo: { country: 'GB', region: 'ENG', postalCode: 'EC1A' } })

    expect(body?.params.arguments.catalog.context).toMatchObject({
      address_country: 'GB',
      address_region: 'ENG',
      postal_code: 'EC1A',
    })
  })

  it('does NOT align context for lookup (only search), preserving the default country', async () => {
    // lookup_catalog enforces ships_to regardless of context, and forcing the
    // context hides otherwise-valid products, so lookup must stay unaligned.
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.lookupCatalog({ ids: ['gid://shopify/ProductVariant/1'], shipsTo: { country: 'GB' } })

    expect(body?.params.arguments.catalog.context?.address_country).toBe('US')
  })

  it('looks up ids and gets products with selected options', async () => {
    const names: string[] = []
    const fetchMock = createFetchMock(async (_url, init) => {
      const body = (await readJsonBody(init)) as { params: { name: string } }
      names.push(body.params.name)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.lookupCatalog({ ids: ['gid://shopify/ProductVariant/1'] })
    await client.getProduct({
      id: 'gid://shopify/p/abc',
      selected: [{ name: 'Color', label: 'Black' }],
      preferences: ['Color', 'Size'],
    })

    expect(names).toEqual(['lookup_catalog', 'get_product'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('searches by similarity without a text query', async () => {
    let body: unknown
    const fetchMock = createFetchMock(async (_url, init) => {
      body = await readJsonBody(init)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({ like: [{ id: 'gid://shopify/ProductVariant/1' }] })

    expect(body).toMatchObject({
      params: {
        name: 'search_catalog',
        arguments: {
          catalog: {
            like: [{ id: 'gid://shopify/ProductVariant/1' }],
          },
        },
      },
    })
  })

  it('requires at least one search input', async () => {
    const client = new ShopCatalogClient({ fetch: createFetchMock(() => jsonResponse({})), store: createStore() })
    await expect(client.searchCatalog({})).rejects.toThrow('Search requires')
  })

  it('surfaces MCP error envelopes', async () => {
    const fetchMock = createFetchMock(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad input' } }),
    )
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await expect(client.searchCatalog({ query: 'hat' })).rejects.toThrow('MCP search_catalog')
  })

  it('supports the CLI search command', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const fetchMock = createFetchMock(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } }),
    )

    await createProgram({
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', 'search', 'boots', '--limit', '3'])

    expect(stderr.write).not.toHaveBeenCalled()
    // Defaults to compact markdown, not JSON.
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('No products found'))
  })

  it('emits raw JSON when --format json is passed', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const fetchMock = createFetchMock(() =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } }),
    )

    await createProgram({
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', '--format', 'json', 'search', 'boots'])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('"products": []'))
  })

  it('reads --image from a file path and base64-encodes it (no large argv)', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    let body: { params: { arguments: { catalog: { like?: unknown[] } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })

    // A real (if tiny) PNG payload written to disk; the CLI must read + encode it itself.
    const bytes = Buffer.from('\u0089PNG\r\n\u001a\nfake-png-bytes', 'binary')
    const dir = mkdtempSync(join(tmpdir(), 'shop-cli-img-'))
    const file = join(dir, 'photo.png')
    writeFileSync(file, bytes)

    await createProgram({
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', 'search', '--image', file])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(body?.params.arguments.catalog.like).toEqual([
      { image: { content_type: 'image/png', data: bytes.toString('base64') } },
    ])
  })

  it('never persists --country; only `config set-country` does', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const store = createStore()
    const bodies: Array<{ params: { arguments: { catalog: { context?: { address_country?: string } } } } }> = []
    const fetchMock = createFetchMock(async (_url, init) => {
      bodies.push((await readJsonBody(init)) as (typeof bodies)[number])
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
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

    // A bare search never writes a stored preference.
    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots'])
    await expect(store.get(COUNTRY_ACCOUNT)).resolves.toBeNull()

    // Explicit --country is transient: applied to the request, but not persisted.
    await createProgram(base).parseAsync(['node', 'shop', '--country', 'CA', 'search', 'boots'])
    await expect(store.get(COUNTRY_ACCOUNT)).resolves.toBeNull()
    expect(bodies.at(-1)?.params.arguments.catalog.context?.address_country).toBe('CA')

    // `config set-country` is the only way to persist a default.
    await createProgram(base).parseAsync(['node', 'shop', 'config', 'set-country', 'gb'])
    await expect(store.get(COUNTRY_ACCOUNT)).resolves.toBe('GB')

    // The stored default is now used when --country is omitted...
    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots'])
    expect(bodies.at(-1)?.params.arguments.catalog.context?.address_country).toBe('GB')

    // ...but an explicit --country still overrides the stored default for that call.
    await createProgram(base).parseAsync(['node', 'shop', '--country', 'FR', 'search', 'boots'])
    expect(bodies.at(-1)?.params.arguments.catalog.context?.address_country).toBe('FR')
    await expect(store.get(COUNTRY_ACCOUNT)).resolves.toBe('GB')
  })

  it('--include-unavailable omits the availability filter (returns both)', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const bodies: Array<{ params: { arguments: { catalog: { filters?: Record<string, unknown> } } } }> = []
    const fetchMock = createFetchMock(async (_url, init) => {
      bodies.push((await readJsonBody(init)) as (typeof bodies)[number])
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

    // Default search restricts to available products.
    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots'])
    expect(bodies.at(-1)?.params.arguments.catalog.filters?.available).toBe(true)

    // --include-unavailable drops the filter entirely so both are returned.
    await createProgram(base).parseAsync(['node', 'shop', 'search', 'boots', '--include-unavailable'])
    expect(bodies.at(-1)?.params.arguments.catalog.filters ?? {}).not.toHaveProperty('available')
  })

  it('rejects out-of-range --limit and non-integer values', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const base = {
      fetch: createFetchMock(() => jsonResponse({})),
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }

    await expect(
      createProgram(base).parseAsync(['node', 'shop', 'search', 'boots', '--limit', '99']),
    ).rejects.toThrow()
    await expect(
      createProgram(base).parseAsync(['node', 'shop', 'search', 'boots', '--limit', '12abc']),
    ).rejects.toThrow()
  })

  it('maps --ships-from comma list and --cursor onto the catalog request', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    let body: { params: { arguments: { catalog: { filters?: Record<string, unknown>; pagination?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })

    await createProgram({
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', 'search', 'coffee mug', '--ships-from', 'US,CA', '--cursor', 'CURSOR_ABC', '--limit', '8'])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(body?.params.arguments.catalog.filters?.ships_from).toEqual([{ country: 'US' }, { country: 'CA' }])
    expect(body?.params.arguments.catalog.pagination).toEqual({ limit: 8, cursor: 'CURSOR_ABC' })
  })

  it('supports unified CLI search plus catalog lookup and get-product', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const names: string[] = []
    const fetchMock = createFetchMock(async (_url, init) => {
      const body = (await readJsonBody(init)) as { params: { name: string } }
      names.push(body.params.name)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
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

    await createProgram(base).parseAsync([
      'node',
      'shop',
      'search',
      '--like-id',
      'gid://shopify/ProductVariant/1',
      '--image',
      'image/jpeg:abc',
    ])
    await createProgram(base).parseAsync(['node', 'shop', 'catalog', 'lookup', 'gid://shopify/ProductVariant/1'])
    await createProgram(base).parseAsync([
      'node',
      'shop',
      'catalog',
      'get-product',
      'gid://shopify/p/abc',
      '--select',
      'Color=Black',
      '--preference',
      'Color',
    ])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(names).toEqual(['search_catalog', 'lookup_catalog', 'get_product'])
  })
})

describe('short catalog id normalization', () => {
  it('re-attaches the gid prefix to the short ids `shop search` renders', () => {
    // Product UPID (base62) -> product gid; numeric -> variant gid.
    expect(normalizeCatalogId('726UZpN2PiLLZ1MYfYRCHm')).toBe('gid://shopify/p/726UZpN2PiLLZ1MYfYRCHm')
    expect(normalizeCatalogId('50362300006715')).toBe('gid://shopify/ProductVariant/50362300006715')
  })

  it('passes already-qualified gids (and unknown shapes) through untouched', () => {
    expect(normalizeCatalogId('gid://shopify/p/abc')).toBe('gid://shopify/p/abc')
    expect(normalizeCatalogId('gid://shopify/ProductVariant/1')).toBe('gid://shopify/ProductVariant/1')
    expect(normalizeCatalogId('gid://shopify/Product/67890')).toBe('gid://shopify/Product/67890')
  })

  it('lookup normalizes each short id before calling the catalog', async () => {
    let body: { params: { arguments: { catalog: { ids?: unknown } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.lookupCatalog({ ids: ['726UZpN2PiLLZ1MYfYRCHm', '50362300006715', 'gid://shopify/p/keep'] })

    expect(body?.params.arguments.catalog.ids).toEqual([
      'gid://shopify/p/726UZpN2PiLLZ1MYfYRCHm',
      'gid://shopify/ProductVariant/50362300006715',
      'gid://shopify/p/keep',
    ])
  })

  it('get_product normalizes a short product id before calling the catalog', async () => {
    let body: { params: { arguments: { catalog: { id?: unknown } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.getProduct({ id: '726UZpN2PiLLZ1MYfYRCHm' })

    expect(body?.params.arguments.catalog.id).toBe('gid://shopify/p/726UZpN2PiLLZ1MYfYRCHm')
  })

  it('--like-id short ids are normalized, image references are left intact', async () => {
    let body: { params: { arguments: { catalog: { like?: unknown } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.searchCatalog({
      like: [{ id: '50362300006715' }, { image: { content_type: 'image/jpeg', data: 'abc' } }],
    })

    expect(body?.params.arguments.catalog.like).toEqual([
      { id: 'gid://shopify/ProductVariant/50362300006715' },
      { image: { content_type: 'image/jpeg', data: 'abc' } },
    ])
  })
})

describe('currency context parity for lookup and get-product', () => {
  it('lookup forwards --currency as context.currency', async () => {
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { products: [] } } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.lookupCatalog({ ids: ['gid://shopify/p/abc'], country: 'GB', currency: 'GBP' })

    expect(body?.params.arguments.catalog.context).toMatchObject({ address_country: 'GB', currency: 'GBP' })
  })

  it('get_product forwards --currency as context.currency', async () => {
    let body: { params: { arguments: { catalog: { context?: Record<string, unknown> } } } } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } })
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.getProduct({ id: 'gid://shopify/p/abc', country: 'GB', currency: 'GBP' })

    expect(body?.params.arguments.catalog.context).toMatchObject({ address_country: 'GB', currency: 'GBP' })
  })
})
