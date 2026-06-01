import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { COUNTRY_ACCOUNT, GLOBAL_CATALOG_MCP_URL } from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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

  it('supports unified CLI search plus catalog lookup and get-product', async () => {
    const { createProgram } = await import('../src/cli.js')
    const stdout = { write: vi.fn() }
    const stderr = { write: vi.fn() }
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
