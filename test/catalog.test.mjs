import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  searchProducts,
  similarProducts,
  readImageAsBase64,
  normalizeProducts,
  parseMarkdownProducts,
  attachPolicies,
} from '../lib/catalog.mjs';

function tmpFile(ext) {
  return join(tmpdir(), `catalog-test-${randomBytes(6).toString('hex')}${ext}`);
}

describe('searchProducts', () => {
  afterEach(() => mock.restoreAll());

  it('builds correct URL with all params', async () => {
    let capturedUrl;
    mock.method(globalThis, 'fetch', async (url) => {
      capturedUrl = url;
      return { ok: true, text: async () => 'results' };
    });

    await searchProducts({
      query: 'shoes',
      limit: 5,
      ships_to: 'CA',
      ships_from: 'US',
      min_price: 10,
      max_price: 100,
      available_for_sale: 1,
      include_secondhand: 0,
      categories: 'footwear,sneakers',
      shop_ids: '123',
      products_limit: 8,
    });

    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('query'), 'shoes');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('ships_to'), 'CA');
    assert.equal(url.searchParams.get('ships_from'), 'US');
    assert.equal(url.searchParams.get('min_price'), '10');
    assert.equal(url.searchParams.get('max_price'), '100');
    assert.equal(url.searchParams.get('available_for_sale'), '1');
    assert.equal(url.searchParams.get('include_secondhand'), '0');
    assert.equal(url.searchParams.get('categories'), 'footwear,sneakers');
    assert.equal(url.searchParams.get('shop_ids'), '123');
    assert.equal(url.searchParams.get('products_limit'), '8');
  });

  it('uses defaults when no optional params', async () => {
    let capturedUrl;
    mock.method(globalThis, 'fetch', async (url) => {
      capturedUrl = url;
      return { ok: true, text: async () => '' };
    });

    await searchProducts({ query: 'hat' });

    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('query'), 'hat');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('ships_to'), 'US');
    assert.equal(url.searchParams.get('available_for_sale'), '1');
    assert.equal(url.searchParams.get('include_secondhand'), '1');
    assert.equal(url.searchParams.get('products_limit'), '10');
    // Optional params should not be present
    assert.equal(url.searchParams.has('ships_from'), false);
    assert.equal(url.searchParams.has('min_price'), false);
    assert.equal(url.searchParams.has('max_price'), false);
    assert.equal(url.searchParams.has('categories'), false);
    assert.equal(url.searchParams.has('shop_ids'), false);
  });

  it('throws on non-ok response and includes response body', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'something went wrong',
    }));

    await assert.rejects(
      () => searchProducts({ query: 'test' }),
      /Catalog search failed: 500.*something went wrong/,
    );
  });

  it('rejects numeric-only categories with helpful error', async () => {
    await assert.rejects(
      () => searchProducts({ query: 'test', categories: '652975472' }),
      /categories must be Shopify taxonomy IDs/,
    );
  });

  it('rejects comma-separated numeric-only categories', async () => {
    await assert.rejects(
      () => searchProducts({ query: 'test', categories: '123,456' }),
      /categories must be Shopify taxonomy IDs/,
    );
  });

  it('accepts taxonomy-format categories', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      text: async () => 'results',
    }));

    await searchProducts({ query: 'test', categories: 'el-1,aa-3-2' });
    assert.equal(globalThis.fetch.mock.callCount(), 1);
  });

  it('rejects domain-format shop_ids with helpful error', async () => {
    await assert.rejects(
      () => searchProducts({ query: 'test', shop_ids: 'shopstauk.myshopify.com' }),
      /shop_ids must be numeric shop IDs/,
    );
  });

  it('accepts numeric shop_ids', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      text: async () => 'results',
    }));

    await searchProducts({ query: 'test', shop_ids: '123,456' });
    assert.equal(globalThis.fetch.mock.callCount(), 1);
  });
});

describe('similarProducts', () => {
  afterEach(() => mock.restoreAll());

  it('builds correct POST body with product ID', async () => {
    let capturedBody;
    mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, text: async () => 'similar' };
    });

    await similarProducts({ id: 'product-123', limit: 5, ships_to: 'US' });

    assert.deepEqual(capturedBody.similarTo, { id: 'product-123' });
    assert.equal(capturedBody.limit, 5);
    assert.equal(capturedBody.ships_to, 'US');
  });

  it('includes response body in error on non-ok response', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'invalid similarTo field',
    }));

    await assert.rejects(
      () => similarProducts({ id: 'test-123' }),
      /Similar products search failed: 400.*invalid similarTo field/,
    );
  });

  it('builds correct POST body with media', async () => {
    let capturedBody;
    mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, text: async () => 'similar' };
    });

    const media = { contentType: 'image/jpeg', base64: 'abc123' };
    await similarProducts({ media });

    assert.deepEqual(capturedBody.similarTo, { media });
  });
});

describe('readImageAsBase64', () => {
  it('reads PNG dimensions correctly', () => {
    // Minimal valid PNG: 8-byte signature + 25-byte IHDR chunk
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrLength = Buffer.alloc(4);
    ihdrLength.writeUInt32BE(13, 0); // IHDR data is 13 bytes
    const ihdrType = Buffer.from('IHDR');
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(320, 0);  // width
    ihdrData.writeUInt32BE(240, 4);  // height
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // color type (RGB)
    const ihdrCrc = Buffer.alloc(4); // dummy CRC
    const png = Buffer.concat([sig, ihdrLength, ihdrType, ihdrData, ihdrCrc]);

    const path = tmpFile('.png');
    writeFileSync(path, png);
    try {
      const result = readImageAsBase64(path);
      assert.equal(result.width, 320);
      assert.equal(result.height, 240);
      assert.equal(result.contentType, 'image/png');
      assert.equal(result.base64, png.toString('base64'));
    } finally {
      unlinkSync(path);
    }
  });

  it('reads JPEG dimensions correctly', () => {
    // Minimal JPEG with SOI + SOF0 marker containing dimensions
    const soi = Buffer.from([0xff, 0xd8]); // Start of Image
    // SOF0 marker: FF C0, length (2 bytes), precision (1), height (2), width (2)
    const sof0 = Buffer.from([
      0xff, 0xc0,       // SOF0 marker
      0x00, 0x0b,       // length (11 bytes)
      0x08,             // precision (8 bits)
      0x01, 0xe0,       // height = 480
      0x02, 0x80,       // width = 640
      0x03,             // num components
      0x00, 0x00,       // padding
    ]);
    const jpeg = Buffer.concat([soi, sof0]);

    const path = tmpFile('.jpg');
    writeFileSync(path, jpeg);
    try {
      const result = readImageAsBase64(path);
      assert.equal(result.width, 640);
      assert.equal(result.height, 480);
      assert.equal(result.contentType, 'image/jpeg');
    } finally {
      unlinkSync(path);
    }
  });

  it('detects content type from extension', () => {
    const buf = Buffer.from([0x00]);

    for (const [ext, expected] of [
      ['.png', 'image/png'],
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.webp', 'image/webp'],
      ['.gif', 'image/gif'],
    ]) {
      const path = tmpFile(ext);
      writeFileSync(path, buf);
      try {
        const result = readImageAsBase64(path);
        assert.equal(result.contentType, expected, `Expected ${expected} for ${ext}`);
      } finally {
        unlinkSync(path);
      }
    }
  });
});

describe('parseMarkdownProducts', () => {
  const singleProduct = [
    'Cool Sneakers',
    '$99.00 USD at ShoeCo — 4.5/5 (100 reviews)',
    'https://shoeco.com/products/cool-sneakers?variant=12345&_gsid=abc',
    'Img: https://cdn.shopify.com/shoes.jpg',
    'id: prod123',
    '',
    'Great sneakers for running.',
    '',
    'Features: Lightweight | Breathable',
    'Specs: Size: 10 | Color: Blue',
    '',
    'Checkout: https://shoeco.com/cart/{id}:1?_gsid=abc&payment=shop_pay',
  ].join('\n');

  it('parses a single product', () => {
    const result = parseMarkdownProducts(singleProduct);
    assert.equal(result.length, 1);
    const p = result[0];
    assert.equal(p.title, 'Cool Sneakers');
    assert.equal(p.price, '$99.00 USD');
    assert.equal(p.brand, 'ShoeCo');
    assert.equal(p.rating, '4.5/5 (100 reviews)');
    assert.equal(p.product_url, 'https://shoeco.com/products/cool-sneakers?variant=12345&_gsid=abc');
    assert.equal(p.image_url, 'https://cdn.shopify.com/shoes.jpg');
    assert.equal(p.product_id, 'prod123');
    assert.equal(p.description, 'Great sneakers for running.');
    assert.ok(p.options.includes('Features: Lightweight'));
    assert.ok(p.options.includes('Specs: Size: 10'));
    assert.equal(p.variant_id, '12345');
    assert.equal(p.shop_domain, 'shoeco.com');
  });

  it('replaces {id} in checkout URL with variant_id', () => {
    const result = parseMarkdownProducts(singleProduct);
    assert.equal(result[0].checkout_url, 'https://shoeco.com/cart/12345:1?_gsid=abc&payment=shop_pay');
  });

  it('parses multiple products separated by ---', () => {
    const multi = singleProduct + '\n\n---\n\n' + singleProduct.replace('Cool Sneakers', 'Other Shoes');
    const result = parseMarkdownProducts(multi);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Cool Sneakers');
    assert.equal(result[1].title, 'Other Shoes');
  });

  it('handles product without rating', () => {
    const noRating = singleProduct.replace(' — 4.5/5 (100 reviews)', '');
    const result = parseMarkdownProducts(noRating);
    assert.equal(result[0].brand, 'ShoeCo');
    assert.equal(result[0].rating, null);
  });

  it('returns empty array for empty/null input', () => {
    assert.deepEqual(parseMarkdownProducts(''), []);
    assert.deepEqual(parseMarkdownProducts(null), []);
    assert.deepEqual(parseMarkdownProducts(undefined), []);
  });
});

describe('normalizeProducts', () => {
  it('parses markdown string into structured products', () => {
    const markdown = [
      'Test Product',
      '$50.00 USD at TestShop',
      'https://testshop.com/products/test?variant=999',
      'Img: https://cdn.shopify.com/test.jpg',
      'id: abc123',
      '',
      'A test product.',
      '',
      'Checkout: https://testshop.com/cart/{id}:1',
    ].join('\n');
    const result = normalizeProducts(markdown);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Test Product');
    assert.equal(result[0].checkout_url, 'https://testshop.com/cart/999:1');
  });

  it('includes product_id from various field names', () => {
    const products = [
      { id: '111', title: 'A' },
      { product_id: '222', title: 'B' },
      { productId: '333', title: 'C' },
    ];
    const result = normalizeProducts(products);
    assert.equal(result[0].product_id, '111');
    assert.equal(result[1].product_id, '222');
    assert.equal(result[2].product_id, '333');
  });

  it('sets product_id to null when missing', () => {
    const result = normalizeProducts([{ title: 'No ID' }]);
    assert.equal(result[0].product_id, null);
  });
});

describe('attachPolicies', () => {
  const policyMap = new Map([
    ['store-a.com', { shippingPolicyText: 'Free shipping over $50', returnPolicyText: '30 day returns', shippingPolicyUrl: 'https://store-a.com/policies/shipping-policy', returnPolicyUrl: 'https://store-a.com/policies/refund-policy' }],
  ]);

  it('merges policy onto matching products', () => {
    const products = [
      { title: 'A', shop_domain: 'store-a.com' },
      { title: 'B', shop_domain: 'store-b.com' },
    ];
    const result = attachPolicies(products, policyMap);
    assert.deepEqual(result[0].policy, policyMap.get('store-a.com'));
    assert.equal(result[1].policy, null);
  });

  it('returns string responses unchanged', () => {
    assert.equal(attachPolicies('markdown', policyMap), 'markdown');
  });

  it('handles empty policy map', () => {
    const products = [{ title: 'A', shop_domain: 'store-a.com' }];
    const result = attachPolicies(products, new Map());
    assert.equal(result[0].policy, null);
  });
});
