import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ordersForFiltering } from './fixtures/orders.mjs';

// Mock auth before importing graphql so the GraphQL path has a valid token
mock.module('../lib/auth.mjs', {
  namedExports: {
    getValidToken: async () => ({ accessToken: 'test-token' }),
  },
});

const { filterOrders, stripHtml, fetchShopPolicies } = await import('../lib/graphql.mjs');

describe('filterOrders', () => {
  it('returns all orders with no filters', () => {
    const result = filterOrders(ordersForFiltering);
    assert.equal(result.length, 3);
  });

  it('filters by since date', () => {
    const result = filterOrders(ordersForFiltering, { since: '2025-02-01' });
    assert.equal(result.length, 2);
    assert.ok(result.every(o => new Date(o.createdAt) >= new Date('2025-02-01')));
  });

  it('filters by until date', () => {
    const result = filterOrders(ordersForFiltering, { until: '2025-02-28' });
    assert.equal(result.length, 2);
    assert.ok(result.every(o => new Date(o.createdAt) <= new Date('2025-02-28')));
  });

  it('filters by combined since and until', () => {
    const result = filterOrders(ordersForFiltering, { since: '2025-02-01', until: '2025-02-28' });
    assert.equal(result.length, 1);
    assert.equal(result[0].orderNumber, '3002');
  });

  it('filters by delivery status', () => {
    const result = filterOrders(ordersForFiltering, { status: 'DELIVERED' });
    assert.equal(result.length, 1);
    assert.equal(result[0].orderNumber, '3001');
  });

  it('matches status case-insensitively', () => {
    const result = filterOrders(ordersForFiltering, { status: 'in_transit' });
    assert.equal(result.length, 1);
    assert.equal(result[0].orderNumber, '3002');
  });

  it('returns empty when no status matches', () => {
    const result = filterOrders(ordersForFiltering, { status: 'CANCELLED' });
    assert.equal(result.length, 0);
  });

  it('filters by combined since + status', () => {
    const result = filterOrders(ordersForFiltering, { since: '2025-02-01', status: 'in_transit' });
    assert.equal(result.length, 1);
    assert.equal(result[0].orderNumber, '3002');
  });

  it('returns empty when since + status combination has no matches', () => {
    const result = filterOrders(ordersForFiltering, { since: '2025-03-01', status: 'DELIVERED' });
    assert.equal(result.length, 0);
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('converts headings to markdown', () => {
    const result = stripHtml('<h2>Return Policy</h2>');
    assert.ok(result.includes('## Return Policy'));
  });

  it('converts list items', () => {
    const result = stripHtml('<ul><li>Item one</li><li>Item two</li></ul>');
    assert.ok(result.includes('- Item one'));
    assert.ok(result.includes('- Item two'));
  });

  it('removes script and style blocks', () => {
    const result = stripHtml('<script>alert("x")</script><style>.a{}</style><p>Content</p>');
    assert.ok(!result.includes('alert'));
    assert.ok(!result.includes('.a{}'));
    assert.ok(result.includes('Content'));
  });

  it('decodes HTML entities', () => {
    assert.equal(stripHtml('&amp; &lt; &gt; &#39; &quot;'), '& < > \' "');
  });

  it('collapses multiple blank lines', () => {
    const result = stripHtml('<p>A</p><p></p><p></p><p>B</p>');
    assert.ok(!result.includes('\n\n\n'));
  });
});

describe('fetchShopPolicies', () => {
  afterEach(() => {
    globalThis.fetch?.mock?.resetCalls?.();
    mock.restoreAll();
    mock.module('../lib/auth.mjs', {
      namedExports: {
        getValidToken: async () => ({ accessToken: 'test-token' }),
      },
    });
  });

  it('uses GraphQL to fetch policies when product_id is available', async () => {
    const fetched = [];
    mock.method(globalThis, 'fetch', async (url, opts) => {
      fetched.push(url);
      // GraphQL request
      if (url === 'https://server.shop.app/graphql') {
        return {
          ok: true,
          json: async () => ({
            data: {
              storefrontProduct: {
                shop: {
                  policies: {
                    shippingPolicy: { embedUrl: 'https://checkout.shopify.com/123/policies/ship.html' },
                    returnPolicy: { embedUrl: 'https://checkout.shopify.com/123/policies/ret.html' },
                  },
                },
              },
            },
          }),
        };
      }
      // embedUrl fetches
      if (url.includes('ship.html')) {
        return { ok: true, text: async () => '<p>Free shipping over $50</p>' };
      }
      if (url.includes('ret.html')) {
        return { ok: true, text: async () => '<p>30 day returns</p>' };
      }
      return { ok: false };
    });

    const products = [
      { shop_domain: 'store-a.com', product_id: '999' },
      { shop_domain: 'store-a.com', product_id: '888' },  // deduped
    ];
    const result = await fetchShopPolicies(products);

    // 1 GraphQL + 2 embedUrl fetches (deduped by domain)
    assert.equal(fetched.length, 3);
    assert.equal(result.size, 1);
    assert.deepEqual(result.get('store-a.com'), {
      shippingPolicyText: 'Free shipping over $50',
      returnPolicyText: '30 day returns',
      shippingPolicyUrl: 'https://checkout.shopify.com/123/policies/ship.html',
      returnPolicyUrl: 'https://checkout.shopify.com/123/policies/ret.html',
    });
  });

  it('falls back to HTML when no product_id, deduped by shop_domain', async () => {
    const fetched = [];
    mock.method(globalThis, 'fetch', async (url) => {
      fetched.push(url);
      if (url === 'https://store-a.com/policies/shipping-policy') {
        return { ok: true, text: async () => '<p>Free shipping over $50</p>' };
      }
      if (url === 'https://store-a.com/policies/refund-policy') {
        return { ok: true, text: async () => '<p>30 day returns</p>' };
      }
      return { ok: false };
    });

    const products = [
      { shop_domain: 'store-a.com' },
      { shop_domain: 'store-a.com' },  // same shop, should be deduped
    ];
    const result = await fetchShopPolicies(products);

    // Only two fetches (shipping + refund) since both products share shop_domain
    assert.equal(fetched.length, 2);
    assert.equal(result.size, 1);
    assert.deepEqual(result.get('store-a.com'), {
      shippingPolicyText: 'Free shipping over $50',
      returnPolicyText: '30 day returns',
      shippingPolicyUrl: 'https://store-a.com/policies/shipping-policy',
      returnPolicyUrl: 'https://store-a.com/policies/refund-policy',
    });
  });

  it('sets null when store has no policy (HTML fallback)', async () => {
    mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));

    const result = await fetchShopPolicies([{ shop_domain: 'store.com' }]);
    assert.equal(result.size, 1);
    assert.deepEqual(result.get('store.com'), {
      shippingPolicyText: null,
      returnPolicyText: null,
      shippingPolicyUrl: null,
      returnPolicyUrl: null,
    });
  });

  it('sets null when GraphQL returns no embedUrls', async () => {
    mock.method(globalThis, 'fetch', async (url) => {
      if (url === 'https://server.shop.app/graphql') {
        return {
          ok: true,
          json: async () => ({
            data: {
              storefrontProduct: {
                shop: { policies: { shippingPolicy: null, returnPolicy: null } },
              },
            },
          }),
        };
      }
      return { ok: false };
    });

    const result = await fetchShopPolicies([{ shop_domain: 'store.com', product_id: '111' }]);
    assert.equal(result.size, 1);
    assert.deepEqual(result.get('store.com'), {
      shippingPolicyText: null,
      returnPolicyText: null,
      shippingPolicyUrl: null,
      returnPolicyUrl: null,
    });
  });

  it('returns empty map when no products have shop_domain', async () => {
    const result = await fetchShopPolicies([{ product_id: '111' }]);
    assert.equal(result.size, 0);
  });

  it('returns empty map for non-array input', async () => {
    const result = await fetchShopPolicies('not an array');
    assert.equal(result.size, 0);
  });
});
