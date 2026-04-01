import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

let nextProducts = [
  { title: 'Shoes', price: '$99.00', product_url: 'https://shop.example.com/shoes' },
  { title: 'Hat', price: '$25.00', product_url: 'https://shop.example.com/hat' },
];
let nextSearchResponse = 'raw-response';

const mockSearchProducts = mock.fn(async () => nextSearchResponse);
const mockNormalizeProducts = mock.fn(() => nextProducts);
const mockConvertPrice = mock.fn(async (price, to) => `\u20ac85.00`);
const mockFormatProductsMarkdown = mock.fn(() => 'markdown-output');

mock.module('../../lib/catalog.mjs', {
  namedExports: {
    searchProducts: mockSearchProducts,
    normalizeProducts: mockNormalizeProducts,
  },
});

mock.module('../../lib/currency.mjs', {
  namedExports: {
    convertPrice: mockConvertPrice,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatProductsMarkdown: mockFormatProductsMarkdown,
  },
});

const { searchCommand } = await import('../../lib/commands/search.mjs');

describe('search command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextProducts = [
      { title: 'Shoes', price: '$99.00', product_url: 'https://shop.example.com/shoes' },
      { title: 'Hat', price: '$25.00', product_url: 'https://shop.example.com/hat' },
    ];
    nextSearchResponse = 'raw-response';

    mockSearchProducts.mock.resetCalls();
    mockSearchProducts.mock.mockImplementation(async () => nextSearchResponse);
    mockNormalizeProducts.mock.resetCalls();
    mockNormalizeProducts.mock.mockImplementation(() => nextProducts);
    mockConvertPrice.mock.resetCalls();
    mockConvertPrice.mock.mockImplementation(async (price, to) => `\u20ac85.00`);
    mockFormatProductsMarkdown.mock.resetCalls();
    mockFormatProductsMarkdown.mock.mockImplementation(() => 'markdown-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    searchCommand(program);

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

  // ── 1. Happy path ──────────────────────────────────────────────────
  it('calls searchProducts, normalizeProducts, formatProductsMarkdown and prints markdown', async () => {
    await program.parseAsync(['node', 'test', 'search', 'running shoes']);

    assert.equal(mockSearchProducts.mock.callCount(), 1);
    assert.equal(mockNormalizeProducts.mock.callCount(), 1);
    assert.equal(mockNormalizeProducts.mock.calls[0].arguments[0], nextSearchResponse);
    assert.equal(mockFormatProductsMarkdown.mock.callCount(), 1);
    assert.equal(mockFormatProductsMarkdown.mock.calls[0].arguments[0], nextProducts);

    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'markdown-output');
  });

  // ── 2. Verifies searchProducts params with defaults ────────────────
  it('passes correct default params to searchProducts', async () => {
    await program.parseAsync(['node', 'test', 'search', 'sneakers']);

    const params = mockSearchProducts.mock.calls[0].arguments[0];
    assert.equal(params.query, 'sneakers');
    assert.equal(params.limit, '10');
    assert.equal(params.ships_to, 'US');
    assert.equal(params.available_for_sale, 1);
    assert.equal(params.include_secondhand, 1);
  });

  // ── 3. --json outputs JSON.stringify of products ───────────────────
  it('outputs JSON when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'search', 'hats', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const output = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(output, nextProducts);
    assert.equal(mockFormatProductsMarkdown.mock.callCount(), 0);
  });

  // ── 4. --convert-to EUR calls convertPrice per product ─────────────
  it('calls convertPrice for each product with a price when --convert-to is given', async () => {
    await program.parseAsync(['node', 'test', 'search', 'boots', '--convert-to', 'EUR']);

    assert.equal(mockConvertPrice.mock.callCount(), 2);
    assert.equal(mockConvertPrice.mock.calls[0].arguments[0], '$99.00');
    assert.equal(mockConvertPrice.mock.calls[0].arguments[1], 'EUR');
    assert.equal(mockConvertPrice.mock.calls[1].arguments[0], '$25.00');
    assert.equal(mockConvertPrice.mock.calls[1].arguments[1], 'EUR');

    assert.equal(nextProducts[0].converted_price, '\u20ac85.00');
    assert.equal(nextProducts[1].converted_price, '\u20ac85.00');
  });

  // ── 5. Options pass through to searchProducts ──────────────────────
  it('passes all CLI options to searchProducts', async () => {
    await program.parseAsync([
      'node', 'test', 'search', 'footwear',
      '--limit', '5',
      '--ships-to', 'CA',
      '--ships-from', 'US',
      '--min-price', '10',
      '--max-price', '100',
      '--new-only',
      '--categories', 'foot',
      '--shop-ids', '123',
      '--products-limit', '8',
    ]);

    const params = mockSearchProducts.mock.calls[0].arguments[0];
    assert.equal(params.query, 'footwear');
    assert.equal(params.limit, '5');
    assert.equal(params.ships_to, 'CA');
    assert.equal(params.ships_from, 'US');
    assert.equal(params.min_price, '10');
    assert.equal(params.max_price, '100');
    assert.equal(params.include_secondhand, 0);
    assert.equal(params.categories, 'foot');
    assert.equal(params.shop_ids, '123');
    assert.equal(params.products_limit, '8');
  });

  // ── 6. --new-only sets include_secondhand to 0 ─────────────────────
  it('sets include_secondhand to 0 when --new-only is passed', async () => {
    await program.parseAsync(['node', 'test', 'search', 'shirts', '--new-only']);

    const params = mockSearchProducts.mock.calls[0].arguments[0];
    assert.equal(params.include_secondhand, 0);
  });

  // ── 7. searchProducts throws: prints error and exits 1 ────────────
  it('prints error and exits 1 when searchProducts throws', async () => {
    mockSearchProducts.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'search', 'broken']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Network failure'),
    ));
  });

  // ── 8. Products without price don't get convertPrice called ────────
  it('does not call convertPrice for products without a price', async () => {
    nextProducts = [
      { title: 'Free Sample', product_url: 'https://shop.example.com/free' },
      { title: 'Hat', price: '$25.00', product_url: 'https://shop.example.com/hat' },
    ];
    mockNormalizeProducts.mock.mockImplementation(() => nextProducts);

    await program.parseAsync(['node', 'test', 'search', 'freebies', '--convert-to', 'EUR']);

    assert.equal(mockConvertPrice.mock.callCount(), 1);
    assert.equal(mockConvertPrice.mock.calls[0].arguments[0], '$25.00');
  });

  // ── 9. normalizeProducts returns string: no convertPrice even with --convert-to ─
  it('does not call convertPrice when normalizeProducts returns a string', async () => {
    nextProducts = '## Products\n- Shoe $50';
    mockNormalizeProducts.mock.mockImplementation(() => nextProducts);

    await program.parseAsync(['node', 'test', 'search', 'markdown-mode', '--convert-to', 'EUR']);

    assert.equal(mockConvertPrice.mock.callCount(), 0);
  });

});
