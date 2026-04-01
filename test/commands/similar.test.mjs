import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

let nextProducts = [{ title: 'Similar Item', price: '$50.00' }];
let nextImageData = { width: 800, height: 600, contentType: 'image/jpeg', base64: 'abc123' };

const mockSimilarProducts = mock.fn(async () => 'raw-response');
const mockNormalizeProducts = mock.fn(() => nextProducts);
const mockReadImageAsBase64 = mock.fn((path) => nextImageData);
const mockAttachPolicies = mock.fn((products) => products);
const mockConvertPrice = mock.fn(async () => '\u20ac42.00');
const mockFetchShopPolicies = mock.fn(async () => new Map());
const mockFormatProductsMarkdown = mock.fn(() => 'markdown-output');

mock.module('../../lib/catalog.mjs', {
  namedExports: {
    similarProducts: mockSimilarProducts,
    normalizeProducts: mockNormalizeProducts,
    readImageAsBase64: mockReadImageAsBase64,
    attachPolicies: mockAttachPolicies,
  },
});

mock.module('../../lib/currency.mjs', {
  namedExports: {
    convertPrice: mockConvertPrice,
  },
});

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchShopPolicies: mockFetchShopPolicies,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatProductsMarkdown: mockFormatProductsMarkdown,
  },
});

const { similarCommand } = await import('../../lib/commands/similar.mjs');

describe('similar command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextProducts = [{ title: 'Similar Item', price: '$50.00' }];
    nextImageData = { width: 800, height: 600, contentType: 'image/jpeg', base64: 'abc123' };

    mockSimilarProducts.mock.resetCalls();
    mockSimilarProducts.mock.mockImplementation(async () => 'raw-response');
    mockNormalizeProducts.mock.resetCalls();
    mockNormalizeProducts.mock.mockImplementation(() => nextProducts);
    mockReadImageAsBase64.mock.resetCalls();
    mockReadImageAsBase64.mock.mockImplementation((path) => nextImageData);
    mockAttachPolicies.mock.resetCalls();
    mockAttachPolicies.mock.mockImplementation((products) => products);
    mockConvertPrice.mock.resetCalls();
    mockConvertPrice.mock.mockImplementation(async () => '\u20ac42.00');
    mockFetchShopPolicies.mock.resetCalls();
    mockFetchShopPolicies.mock.mockImplementation(async () => new Map());
    mockFormatProductsMarkdown.mock.resetCalls();
    mockFormatProductsMarkdown.mock.mockImplementation(() => 'markdown-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    similarCommand(program);

    logMock = mock.method(console, 'log', () => {});
    errorMock = mock.method(console, 'error', () => {});
    mock.method(process, 'exit', (code) => {
      exitCode = code;
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ── 1. Happy path with --product-id ─────────────────────────────────
  it('calls similarProducts with product ID and prints markdown', async () => {
    await program.parseAsync(['node', 'test', 'similar', '--product-id', 'gid://123']);

    assert.equal(mockSimilarProducts.mock.callCount(), 1);
    assert.deepEqual(mockSimilarProducts.mock.calls[0].arguments[0], {
      id: 'gid://123',
      limit: '10',
      ships_to: 'US',
    });

    assert.equal(mockNormalizeProducts.mock.callCount(), 1);
    assert.equal(mockNormalizeProducts.mock.calls[0].arguments[0], 'raw-response');

    assert.equal(mockFormatProductsMarkdown.mock.callCount(), 1);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'markdown-output');
  });

  // ── 2. Happy path with --image (small image) ───────────────────────
  it('calls readImageAsBase64 and similarProducts with media for small image', async () => {
    await program.parseAsync(['node', 'test', 'similar', '--image', 'photo.jpg']);

    assert.equal(mockReadImageAsBase64.mock.callCount(), 1);
    assert.equal(mockReadImageAsBase64.mock.calls[0].arguments[0], 'photo.jpg');

    assert.equal(mockSimilarProducts.mock.callCount(), 1);
    const params = mockSimilarProducts.mock.calls[0].arguments[0];
    assert.deepEqual(params.media, { contentType: 'image/jpeg', base64: 'abc123' });
    assert.equal(params.limit, '10');
    assert.equal(params.ships_to, 'US');
    assert.equal(params.id, undefined);
  });

  // ── 3. Both --product-id and --image: error ────────────────────────
  it('prints error and exits 1 when both --product-id and --image are provided', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'similar', '--product-id', 'gid://123', '--image', 'photo.jpg']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Provide either --product-id or --image, not both'),
    ));
  });

  // ── 4. Neither --product-id nor --image: error ─────────────────────
  it('prints error and exits 1 when neither --product-id nor --image is provided', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'similar']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('One of --product-id or --image is required'),
    ));
  });

  // ── 5. --json outputs JSON ─────────────────────────────────────────
  it('outputs JSON when --json flag is used', async () => {
    await program.parseAsync(['node', 'test', 'similar', '--product-id', 'gid://123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(parsed, nextProducts);

    assert.equal(mockFormatProductsMarkdown.mock.callCount(), 0);
  });

  // ── 6. --convert-to calls convertPrice per product ─────────────────
  it('calls convertPrice for each product with a price when --convert-to is given', async () => {
    nextProducts = [
      { title: 'Item A', price: '$50.00' },
      { title: 'Item B', price: '$30.00' },
      { title: 'Item C', price: null },
    ];

    await program.parseAsync(['node', 'test', 'similar', '--product-id', 'gid://123', '--convert-to', 'GBP']);

    assert.equal(mockConvertPrice.mock.callCount(), 2);
    assert.equal(mockConvertPrice.mock.calls[0].arguments[0], '$50.00');
    assert.equal(mockConvertPrice.mock.calls[0].arguments[1], 'GBP');
    assert.equal(mockConvertPrice.mock.calls[1].arguments[0], '$30.00');
    assert.equal(mockConvertPrice.mock.calls[1].arguments[1], 'GBP');

    assert.equal(nextProducts[0].converted_price, '\u20ac42.00');
    assert.equal(nextProducts[1].converted_price, '\u20ac42.00');
    assert.equal(nextProducts[2].converted_price, undefined);
  });

  // ── 7. similarProducts throws: error and exit 1 ───────────────────
  it('prints error and exits 1 when similarProducts throws', async () => {
    mockSimilarProducts.mock.mockImplementation(async () => {
      throw new Error('API unavailable');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'similar', '--product-id', 'gid://123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('API unavailable'),
    ));
  });
});
