import { readFileSync } from 'node:fs'

import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import { ACCESS_TOKEN_ACCOUNT, CLI_VERSION, SHOP_GRAPHQL_URL, USER_AGENT } from '../src/constants.js'
import { createProgram } from '../src/cli.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import {
  createFetchMock as createBaseFetchMock,
  createStore as createBaseStore,
  jsonResponse,
  readJsonBody,
} from './test-utils.js'

const createFetchMock = (
  handler: Parameters<typeof createBaseFetchMock>[0],
): ReturnType<typeof createBaseFetchMock> =>
  createBaseFetchMock((url, init) =>
    url.endsWith('/userinfo') ? jsonResponse({ sub: 'user-1' }) : handler(url, init),
  )

const createStore = (values: Record<string, string> = {}) =>
  createBaseStore({ [ACCESS_TOKEN_ACCOUNT]: 'access', ...values })

const locationsResponse = {
  data: {
    locationSpecificStorefrontProductVariant: {
      variantId: 'gid://shopify/ProductVariant/50661914640743',
      possiblePickupLocationsV2: {
        totalCount: 2,
        nodes: [
          {
            isAvailable: true,
            quantityAvailable: 3,
            distance: { value: '2.4', unit: 'MILES' },
            location: {
              name: 'Alo Flatiron',
              pickupEtaTranslated: 'Usually ready in 2 hours',
              address: {
                address1: '164 Fifth Ave',
                city: 'New York',
                zoneCode: 'NY',
                country: 'United States',
                postalCode: '10010',
              },
            },
          },
        ],
        pageInfo: {
          startCursor: 'START',
          endCursor: 'NEXT',
          hasNextPage: true,
        },
      },
    },
  },
}

describe('locations', () => {
  it('uses the package version as the authoritative CLI version', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    expect(CLI_VERSION).toBe(packageJson.version)
    expect(USER_AGENT).toBe(`shop-cli/${packageJson.version}`)
  })

  it('queries available inventory for an exact variant near a coarse address', async () => {
    let body: Record<string, unknown> | undefined
    let headers: Record<string, string> | undefined
    const fetchMock = createFetchMock(async (url, init) => {
      expect(url).toBe(SHOP_GRAPHQL_URL)
      body = (await readJsonBody(init)) as Record<string, unknown>
      headers = init.headers as Record<string, string>
      return jsonResponse(locationsResponse)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    const result = await client.locations({
      shopId: 'gid://shopify/Shop/21852813',
      variantId: '50661914640743',
      limit: 8,
      cursor: 'CURSOR',
      nearAddress: { country: 'us', region: 'NY', city: 'New York' },
      maxDistance: { value: 25, unit: 'MILES' },
    })

    expect(result.variantId).toBe('gid://shopify/ProductVariant/50661914640743')
    expect(headers).toMatchObject({
      Authorization: 'Bearer access',
      'User-Agent': USER_AGENT,
    })
    expect(body).toMatchObject({
      operationName: 'ShopCliLocations',
      variables: {
        brokerId: '21852813',
        variantId: 'gid://shopify/ProductVariant/50661914640743',
        first: 8,
        after: 'CURSOR',
        mailingAddress: { country: 'US', zoneCode: 'NY', city: 'New York' },
        pickupAddress: { country: 'US', zoneCode: 'NY', city: 'New York' },
        maxDistance: { value: 25, unit: 'MILES' },
      },
    })
    expect(body?.query).toMatch('possiblePickupLocationsV2')
    expect(body?.query).toMatch('available: true')
    expect(body?.query).toMatch('quantityAvailable')
  })

  it('uses an explicit coarse mailing address with authorized pickup coordinates', async () => {
    let body: { variables?: Record<string, unknown> } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse(locationsResponse)
    })
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await client.locations({
      shopId: '21852813',
      variantId: 'gid://shopify/ProductVariant/50661914640743',
      nearAddress: { country: 'US', postalCode: '10010' },
      nearCoordinate: { latitude: 40.741, longitude: -73.99 },
    })

    expect(body?.variables).toMatchObject({
      brokerId: '21852813',
      variantId: 'gid://shopify/ProductVariant/50661914640743',
      first: 15,
      mailingAddress: { country: 'US', postalCode: '10010' },
      pickupCoordinate: { latitude: 40.741, longitude: -73.99 },
    })
    expect(body?.variables?.pickupAddress).toBeUndefined()
  })

  it('surfaces GraphQL errors and missing pickup data', async () => {
    const graphqlErrorClient = new ShopCatalogClient({
      fetch: createFetchMock(() => jsonResponse({ errors: [{ message: 'Variant unavailable' }] })),
      store: createStore(),
    })
    await expect(
      graphqlErrorClient.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'US', city: 'New York' },
      }),
    ).rejects.toThrow('Locations query failed: Variant unavailable')

    const missingVariantClient = new ShopCatalogClient({
      fetch: createFetchMock(() =>
        jsonResponse({ data: { locationSpecificStorefrontProductVariant: null } }),
      ),
      store: createStore(),
    })
    await expect(
      missingVariantClient.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'US', city: 'New York' },
      }),
    ).rejects.toThrow('Pickup inventory was not found')
  })

  it('rejects invalid pickup inputs before making a request', async () => {
    const fetchMock = createFetchMock(() => jsonResponse(locationsResponse))
    const client = new ShopCatalogClient({ fetch: fetchMock, store: createStore() })

    await expect(
      client.locations({
        shopId: 'not-a-shop',
        variantId: '2',
        nearAddress: { country: 'US', city: 'New York' },
      }),
    ).rejects.toThrow('Invalid Shop ID')
    await expect(
      client.locations({
        shopId: '1',
        variantId: 'not-a-variant',
        nearAddress: { country: 'US', city: 'New York' },
      }),
    ).rejects.toThrow('Invalid variant ID')
    await expect(
      client.locations({
        shopId: '1',
        variantId: '2',
        limit: 51,
        nearAddress: { country: 'US', city: 'New York' },
      }),
    ).rejects.toThrow('1 to 50')
    await expect(
      client.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'USA', city: 'New York' },
      }),
    ).rejects.toThrow('ISO 3166-1')
    await expect(
      client.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'US' },
      }),
    ).rejects.toThrow('city or postal code')
    await expect(
      client.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'US', city: 'New York' },
        nearCoordinate: { latitude: 91, longitude: 0 },
      }),
    ).rejects.toThrow('Latitude must be between')
    await expect(
      client.locations({
        shopId: '1',
        variantId: '2',
        nearAddress: { country: 'US', city: 'New York' },
        maxDistance: { value: 0, unit: 'MILES' },
      }),
    ).rejects.toThrow('positive number')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports the BOPIS locations command and compact inventory rendering', async () => {
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    let body: { variables?: Record<string, unknown> } | undefined
    const fetchMock = createFetchMock(async (_url, init) => {
      body = (await readJsonBody(init)) as typeof body
      return jsonResponse(locationsResponse)
    })

    await createProgram({
      fetch: fetchMock,
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync([
      'node',
      'shop',
      'locations',
      '21852813',
      '50661914640743',
      '--near-country',
      'US',
      '--near-city',
      'New York',
      '--max-distance',
      '5',
      '--distance-unit',
      'miles',
    ])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(body?.variables).toMatchObject({
      brokerId: '21852813',
      variantId: 'gid://shopify/ProductVariant/50661914640743',
      mailingAddress: { country: 'US', city: 'New York' },
      pickupAddress: { country: 'US', city: 'New York' },
      maxDistance: { value: 5, unit: 'MILES' },
    })
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Alo Flatiron — 2.4 mi'))
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Pickup stock: 3 items'))
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Inventory is point-in-time and not reserved'),
    )
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('buyer selects pickup and the store during checkout'),
    )
    expect(stdout.write).not.toHaveBeenCalledWith(expect.stringContaining('50661914640743'))
  })

  it('requires an explicit coarse address and paired coordinate flags', async () => {
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    const base = {
      fetch: createFetchMock(() => jsonResponse(locationsResponse)),
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }

    await expect(
      createProgram(base).parseAsync([
        'node',
        'shop',
        'locations',
        '1',
        '2',
      ]),
    ).rejects.toThrow('exit 1')
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Pickup proximity requires --near-country'),
    )

    await expect(
      createProgram(base).parseAsync([
        'node',
        'shop',
        'locations',
        '1',
        '2',
        '--near-country',
        'US',
        '--near-city',
        'New York',
        '--near-latitude',
        '40.7',
      ]),
    ).rejects.toThrow('exit 1')
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('--near-latitude and --near-longitude must be provided together'),
    )
  })

  it('emits raw location JSON when --format json is passed', async () => {
    const stdout = { write: fn() }
    const stderr = { write: fn() }

    await createProgram({
      fetch: createFetchMock(() => jsonResponse(locationsResponse)),
      store: createStore(),
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync([
      'node',
      'shop',
      '--format',
      'json',
      'locations',
      '21852813',
      '50661914640743',
      '--near-country',
      'US',
      '--near-postal-code',
      '10010',
    ])

    expect(stderr.write).not.toHaveBeenCalled()
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"possiblePickupLocationsV2"'),
    )
  })
})
