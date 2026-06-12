import { describe, it } from 'node:test'
import { expect } from './harness.js'

import { renderCatalogResult, withUtm } from '../src/render.js'

const searchResponse = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    structuredContent: {
      products: [
        {
          id: 'gid://shopify/p/6J8JMOV0g1JeQNJlp3juMV',
          title: 'New Balance 530 Sneaker Womens',
          description: { plain: 'A contemporary athletic sneaker blending high-tech aesthetics with comfort.' },
          url: 'https://kozmoshoes.com/products/new-balance-530-sneaker?variant=46434269724889&_gsid=AxJWpxxBEvbw',
          price_range: {
            min: { amount: 12995, currency: 'CAD' },
            max: { amount: 12995, currency: 'CAD' },
          },
          media: [{ type: 'image', url: 'https://cdn.shopify.com/s/files/1/2995/0112/files/u530csb_nb_02_i.jpg' }],
          metadata: {
            top_features: ['ABZorb midsole absorbs impact', 'Segmented upper increases breathability'],
            tech_specs: ['Upper Material: Mesh, synthetic, leather', 'Closure Type: Lace-up'],
            attributes: [
              { name: 'Color', value: 'Beige' },
              { name: 'Color', value: 'Gray' },
              { name: 'Target gender', value: 'Female' },
            ],
          },
          options: [
            { name: 'Color', values: [{ label: 'Sea Salt With Arid Stone' }] },
            { name: 'Size', values: [{ label: '7.5' }, { label: '8' }, { label: '8.5' }] },
          ],
          rating: { value: 4.7, scale_max: 5, count: 18 },
          variants: [
            {
              id: 'gid://shopify/ProductVariant/46434269724889',
              title: 'Sea Salt With Arid Stone / 7.5',
              price: { amount: 12995, currency: 'CAD' },
              checkout_url:
                'https://kozmoshoes.com/cart/46434269724889:1?_gsid=AxJWpxxBEvbw&payment=shop_pay',
              seller: {
                name: 'Kozmo Shoes',
                id: 'gid://shopify/Shop/29950112',
                domain: 'kozmoshoes.com',
                url: 'https://kozmoshoes.com',
              },
            },
          ],
        },
      ],
    },
  },
}

describe('withUtm', () => {
  it('appends utm params while preserving existing query (including _gsid)', () => {
    const out = withUtm('https://kozmoshoes.com/cart/46434269724889:1?_gsid=AxJWpxxBEvbw&payment=shop_pay')
    const url = new URL(out)
    expect(url.searchParams.get('_gsid')).toBe('AxJWpxxBEvbw')
    expect(url.searchParams.get('payment')).toBe('shop_pay')
    expect(url.searchParams.get('utm_source')).toBe('shop-personal-agent')
    expect(url.searchParams.get('utm_medium')).toBe('shop-skill')
  })

  it('does not clobber utm params that already exist', () => {
    const out = withUtm('https://example.com/p?utm_source=existing')
    expect(new URL(out).searchParams.get('utm_source')).toBe('existing')
  })

  it('returns non-URL strings unchanged', () => {
    expect(withUtm('not a url')).toBe('not a url')
  })
})

describe('renderCatalogResult', () => {
  const md = renderCatalogResult('search_catalog', searchResponse)

  it('renders title, price, seller, shop id, and rating', () => {
    expect(md).toContain('New Balance 530 Sneaker Womens')
    expect(md).toContain('$129.95 CAD at Kozmo Shoes [29950112] — 4.7/5 (18 reviews)')
  })

  it('uses the correct currency symbol per currency (not a hardcoded $)', () => {
    const gbp = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'Whiskey Hand Wash 300ml',
              price_range: { min: { amount: 2000, currency: 'GBP' }, max: { amount: 2000, currency: 'GBP' } },
              variants: [{ id: 'gid://shopify/ProductVariant/1' }],
            },
          ],
        },
      },
    })
    expect(gbp).toContain('£20.00 GBP')
    expect(gbp).not.toContain('$20.00 GBP')
  })

  it('shows the product UPID (short id), not the full gid', () => {
    expect(md).toContain('id: 6J8JMOV0g1JeQNJlp3juMV')
    expect(md).not.toContain('gid://shopify/p/')
  })

  it('appends utm to the product url and preserves _gsid', () => {
    expect(md).toMatch(/https:\/\/kozmoshoes\.com\/products\/[^\s]*_gsid=AxJWpxxBEvbw[^\s]*utm_source=shop-personal-agent/)
  })

  it('renders features, specs, and grouped attributes', () => {
    expect(md).toContain('Features: ABZorb midsole absorbs impact | Segmented upper increases breathability')
    expect(md).toContain('Specs: Upper Material: Mesh, synthetic, leather | Closure Type: Lace-up')
    expect(md).toContain('Color: Beige, Gray')
    expect(md).toContain('Target gender: Female')
  })

  it('renders features/specs when the catalog returns them as newline-delimited strings', () => {
    // This is the real catalog shape (verified against catalog.shopify.com):
    // top_features / tech_specs are newline-delimited strings, not arrays.
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'Whiskey Hand Wash 300ml',
              metadata: {
                top_features:
                  'Amber musk and violet leaf blend: Creates a warm, inviting scent\nCedarwood notes: Helps still the mind\nPatchouli fragrance: Adds balance',
                tech_specs: 'Volume: 300 ml\nProduct Type: Liquid hand soap',
              },
              variants: [{ id: 'gid://shopify/ProductVariant/56011762368898' }],
            },
          ],
        },
      },
    })
    expect(out).toContain(
      'Features: Amber musk and violet leaf blend: Creates a warm, inviting scent | Cedarwood notes: Helps still the mind | Patchouli fragrance: Adds balance',
    )
    expect(out).toContain('Specs: Volume: 300 ml | Product Type: Liquid hand soap')
  })

  it('renders options and variants', () => {
    expect(md).toContain('— Options —')
    expect(md).toContain('Size: 7.5, 8, 8.5')
    expect(md).toContain('— Variants —')
    expect(md).toContain('Sea Salt With Arid Stone / 7.5 (46434269724889)')
  })

  it('renders per-variant availability (status, low stock, and the boolean fallback)', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'Trail Runner Pro',
              variants: [
                {
                  id: 'gid://shopify/ProductVariant/1',
                  options: [{ name: 'Size', label: '8' }],
                  availability: { available: true, status: 'in_stock', running_low: false },
                },
                {
                  id: 'gid://shopify/ProductVariant/2',
                  options: [{ name: 'Size', label: '9' }],
                  availability: { available: true, status: 'in_stock', running_low: true },
                },
                {
                  id: 'gid://shopify/ProductVariant/3',
                  options: [{ name: 'Size', label: '10' }],
                  availability: { available: false },
                },
              ],
            },
          ],
        },
      },
    })
    expect(out).toContain('8 (1) — in stock')
    expect(out).toContain('9 (2) — in stock (low stock)')
    expect(out).toContain('10 (3) — unavailable')
  })

  it('omits availability when the variant has none (no trailing dash)', () => {
    // The base fixture variant has no availability field.
    expect(md).toContain('Sea Salt With Arid Stone / 7.5 (46434269724889)')
    expect(md).not.toMatch(/46434269724889\) —/)
  })

  it('names variants from their option labels, not the repeated product title', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'Baby Toddler Shoes',
              variants: [
                {
                  id: 'gid://shopify/ProductVariant/41722441105468',
                  // Catalog sets variant.title to the product title; real distinction is in options.
                  title: 'Baby Toddler Shoes',
                  options: [
                    { name: 'Color', label: 'Black' },
                    { name: 'Size', label: '6-12 months' },
                  ],
                },
                {
                  id: 'gid://shopify/ProductVariant/41722441138236',
                  title: 'Baby Toddler Shoes',
                  options: [
                    { name: 'Color', label: 'Blue' },
                    { name: 'Size', label: '12-18 months' },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
    expect(out).toContain('Black / 6-12 months (41722441105468)')
    expect(out).toContain('Blue / 12-18 months (41722441138236)')
    // The product title is no longer echoed as a variant name.
    expect(out).not.toContain('Baby Toddler Shoes (41722441105468)')
  })

  it('falls back to variant.title only when it differs from the product title', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'New Balance 530 Sneaker Womens',
              variants: [{ id: 'gid://shopify/ProductVariant/1', title: 'Sea Salt / 8' }],
            },
          ],
        },
      },
    })
    expect(out).toContain('Sea Salt / 8 (1)')
  })

  it('does not show per-variant checkout links in search results', () => {
    expect(md).not.toContain('Checkout:')
  })

  it('links the product page, never the storefront root (seller.url)', () => {
    // The product url is rendered; the bare storefront root is not linked.
    expect(md).toContain('https://kozmoshoes.com/products/new-balance-530-sneaker')
    const linkLines = md.split('\n').filter((l) => l.startsWith('https://kozmoshoes.com'))
    for (const line of linkLines) expect(line).toContain('/products/')
  })

  it('uses the first variant url as the product-page link when product.url is absent', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: "Men's Primal Zen",
              variants: [
                {
                  id: 'gid://shopify/ProductVariant/39546610614330',
                  url: 'https://lemsshoes.com/products/primal-zen?variant=39546610614330',
                  seller: { name: 'Lems Shoes', url: 'https://lemsshoes.com' },
                },
              ],
            },
          ],
        },
      },
    })
    expect(out).toContain('https://lemsshoes.com/products/primal-zen?variant=39546610614330')
  })

  it('omits the product link entirely when neither product.url nor variant.url exists (no store-domain fallback)', () => {
    const noUrl = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [
            {
              title: 'No URL Item',
              variants: [{ seller: { name: 'Kozmo Shoes', url: 'https://kozmoshoes.com' } }],
            },
          ],
        },
      },
    })
    expect(noUrl).toContain('No URL Item')
    // seller.url (storefront root) is never used as the product link.
    expect(noUrl).not.toContain('https://kozmoshoes.com')
  })

  it('shows the UCP checkout link only for get_product, as-is with utm', () => {
    const detail = renderCatalogResult('get_product', {
      result: { structuredContent: { product: searchResponse.result.structuredContent.products[0] } },
    })
    // The real variant id is present; no leaked {id} / %7Bid%7D placeholder.
    expect(detail).toContain('Checkout: https://kozmoshoes.com/cart/46434269724889:1?')
    expect(detail).not.toContain('%7Bid%7D')
    expect(detail).not.toContain('{id}')
    const checkoutLine = detail.split('\n').find((l) => l.startsWith('Checkout:'))!
    const url = new URL(checkoutLine.replace('Checkout: ', ''))
    expect(url.searchParams.get('_gsid')).toBe('AxJWpxxBEvbw')
    expect(url.searchParams.get('utm_medium')).toBe('shop-skill')
  })

  it('handles empty results and not_found messages', () => {
    expect(renderCatalogResult('search_catalog', { result: { structuredContent: { products: [] } } })).toContain(
      'No products found',
    )
    const withNotFound = renderCatalogResult('lookup_catalog', {
      result: {
        structuredContent: {
          products: [],
          messages: [{ type: 'info', code: 'not_found', content: 'gid://shopify/ProductVariant/1' }],
        },
      },
    })
    expect(withNotFound).toContain('Not found: gid://shopify/ProductVariant/1')
  })

  it('renders a single product for get_product', () => {
    const single = renderCatalogResult('get_product', {
      result: { structuredContent: { product: { title: 'Solo Item' } } },
    })
    expect(single).toContain('Solo Item')
  })

  it('surfaces the next-page cursor and total when more results exist', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [{ title: 'Mug' }],
          pagination: { has_next_page: true, total_count: 649, cursor: 'CURSOR_XYZ' },
        },
      },
    })
    expect(out).toContain('~649 total')
    expect(out).toContain('--cursor CURSOR_XYZ')
  })

  it('omits the pagination footer when there is no next page', () => {
    const out = renderCatalogResult('search_catalog', {
      result: {
        structuredContent: {
          products: [{ title: 'Mug' }],
          pagination: { has_next_page: false, total_count: 1 },
        },
      },
    })
    expect(out).not.toContain('--cursor')
  })
})
