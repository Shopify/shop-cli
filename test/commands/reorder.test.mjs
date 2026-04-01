import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

let nextOrder = {
  uuid: 'order-uuid-123',
  name: 'Order #1001',
  canBuyAgain: true,
  shop: { name: 'Cool Store', myshopifyDomain: 'coolstore.myshopify.com', websiteUrl: 'https://coolstore.myshopify.com' },
  lineItems: { nodes: [
    { title: 'Widget', quantity: 2, shopifyVariantId: '11111' },
    { title: 'Gadget', quantity: 1, shopifyVariantId: '22222' },
  ]},
};

const fetchOrderByIdMock = mock.fn(async () => nextOrder);
const formatReorderOutputMock = mock.fn(() => 'reorder-output');

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchOrderById: fetchOrderByIdMock,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatReorderOutput: formatReorderOutputMock,
  },
});

const { reorderCommand } = await import('../../lib/commands/reorder.mjs');

describe('reorder command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextOrder = {
      uuid: 'order-uuid-123',
      name: 'Order #1001',
      canBuyAgain: true,
      shop: { name: 'Cool Store', myshopifyDomain: 'coolstore.myshopify.com', websiteUrl: 'https://coolstore.myshopify.com' },
      lineItems: { nodes: [
        { title: 'Widget', quantity: 2, shopifyVariantId: '11111' },
        { title: 'Gadget', quantity: 1, shopifyVariantId: '22222' },
      ]},
    };

    fetchOrderByIdMock.mock.resetCalls();
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);
    formatReorderOutputMock.mock.resetCalls();
    formatReorderOutputMock.mock.mockImplementation(() => 'reorder-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    reorderCommand(program);

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

  // ── 1. Happy path (canBuyAgain=true) ────────────────────────────────
  it('builds checkout URL with search links and calls formatReorderOutput', async () => {
    await program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']);

    assert.equal(fetchOrderByIdMock.mock.callCount(), 1);
    assert.equal(fetchOrderByIdMock.mock.calls[0].arguments[0], 'order-uuid-123');

    assert.equal(formatReorderOutputMock.mock.callCount(), 1);
    const [order, url, items, skipped] = formatReorderOutputMock.mock.calls[0].arguments;
    assert.equal(order, nextOrder);
    assert.equal(url, 'https://coolstore.myshopify.com/cart/11111:2,22222:1');
    assert.equal(items[0].variantId, '11111');
    assert.equal(items[0].searchUrl, 'https://coolstore.myshopify.com/search?q=Widget');
    assert.equal(items[1].variantId, '22222');
    assert.equal(items[1].searchUrl, 'https://coolstore.myshopify.com/search?q=Gadget');
    assert.deepEqual(skipped, []);

    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'reorder-output');
  });

  // ── 2. Order not found ─────────────────────────────────────────────
  it('prints "Order not found" and exits 1 when order is null', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => null);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'reorder', 'nonexistent']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Order not found'),
    ));
  });

  // ── 3. canBuyAgain=false — no checkout URL, only search links ──────
  it('passes null checkoutUrl when canBuyAgain is false', async () => {
    nextOrder.canBuyAgain = false;
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']);

    assert.equal(formatReorderOutputMock.mock.callCount(), 1);
    const [, url, items, skipped] = formatReorderOutputMock.mock.calls[0].arguments;
    assert.equal(url, null);
    assert.equal(items.length, 2);
    assert.ok(items[0].searchUrl);
    assert.deepEqual(skipped, []);
  });

  // ── 4. Some items missing variantId: skipped with search links ─────
  it('passes skipped items with search URLs and builds partial checkout', async () => {
    nextOrder.lineItems = { nodes: [
      { title: 'Widget', quantity: 2, shopifyVariantId: '11111' },
      { title: 'Mystery Box', quantity: 1, shopifyVariantId: null },
    ]};
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']);

    assert.equal(formatReorderOutputMock.mock.callCount(), 1);
    const [, url, items, skipped] = formatReorderOutputMock.mock.calls[0].arguments;
    assert.equal(url, 'https://coolstore.myshopify.com/cart/11111:2');
    assert.deepEqual(items, [
      { variantId: '11111', quantity: 2, title: 'Widget', searchUrl: 'https://coolstore.myshopify.com/search?q=Widget' },
    ]);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].title, 'Mystery Box');
    assert.equal(skipped[0].searchUrl, 'https://coolstore.myshopify.com/search?q=Mystery%20Box');
  });

  // ── 5. All items lack variantId — still shows output with skipped items ─
  it('passes null checkoutUrl and skipped items when all lack variantId', async () => {
    nextOrder.lineItems = { nodes: [
      { title: 'Mystery Box', quantity: 1, shopifyVariantId: null },
      { title: 'Gift Card', quantity: 1 },
    ]};
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']);

    assert.equal(formatReorderOutputMock.mock.callCount(), 1);
    const [, url, items, skipped] = formatReorderOutputMock.mock.calls[0].arguments;
    assert.equal(url, null);
    assert.deepEqual(items, []);
    assert.equal(skipped.length, 2);
    assert.equal(skipped[0].title, 'Mystery Box');
    assert.equal(skipped[1].title, 'Gift Card');
  });

  // ── 6. No domain ───────────────────────────────────────────────────
  it('prints "Could not determine store domain" and exits 1 when no domain available', async () => {
    nextOrder.shop = { name: 'Cool Store', myshopifyDomain: null, websiteUrl: null };
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Could not determine store domain'),
    ));
  });

  // ── 7. Domain from websiteUrl when myshopifyDomain is null ─────────
  it('extracts hostname from websiteUrl when myshopifyDomain is null', async () => {
    nextOrder.shop = { name: 'Cool Store', myshopifyDomain: null, websiteUrl: 'https://www.coolstore.com/shop' };
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']);

    assert.equal(formatReorderOutputMock.mock.callCount(), 1);
    const [, url] = formatReorderOutputMock.mock.calls[0].arguments;
    assert.equal(url, 'https://www.coolstore.com/cart/11111:2,22222:1');
  });

  // ── 8. fetchOrderById throws ──────────────────────────────────────
  it('prints error message and exits 1 when fetchOrderById throws', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Network failure'),
    ));
  });

  // ── 9. Empty lineItems nodes ──────────────────────────────────────
  it('exits 1 when lineItems nodes is empty', async () => {
    nextOrder.lineItems = { nodes: [] };
    fetchOrderByIdMock.mock.mockImplementation(async () => nextOrder);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'reorder', 'order-uuid-123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('No items from this order are available'),
    ));
  });
});
