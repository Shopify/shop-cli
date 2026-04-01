import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

const testOrder = {
  uuid: 'order-uuid-123',
  name: 'Order #1001',
  shop: { name: 'Cool Store' },
  lineItems: { nodes: [{ title: 'Widget', shopifyProductId: '99991' }, { title: 'Gadget', shopifyProductId: '99992' }] },
  startReturnUrl: 'https://coolstore.myshopify.com/returns/start/123',
  statusPageUrl: 'https://coolstore.myshopify.com/status/123',
};

const testPolicy = { embedUrl: 'https://coolstore.myshopify.com/policies/returns', returnDays: 30 };
const testPolicyText = 'You may return items within 30 days of purchase.';

let nextOrder = testOrder;
let nextPolicy = testPolicy;
let nextPolicyText = testPolicyText;

const mockFetchOrderById = mock.fn(async (uuid) => nextOrder);
const mockFetchReturnPolicy = mock.fn(async (productId) => nextPolicy);
const mockFetchPolicyText = mock.fn(async (url) => nextPolicyText);
const mockFormatReturnsInfo = mock.fn(() => 'formatted-returns-output');

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchOrderById: mockFetchOrderById,
    fetchReturnPolicy: mockFetchReturnPolicy,
    fetchPolicyText: mockFetchPolicyText,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatReturnsInfo: mockFormatReturnsInfo,
  },
});

const { returnsCommand } = await import('../../lib/commands/returns.mjs');

describe('returns command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextOrder = testOrder;
    nextPolicy = testPolicy;
    nextPolicyText = testPolicyText;

    mockFetchOrderById.mock.resetCalls();
    mockFetchOrderById.mock.mockImplementation(async () => nextOrder);
    mockFetchReturnPolicy.mock.resetCalls();
    mockFetchReturnPolicy.mock.mockImplementation(async () => nextPolicy);
    mockFetchPolicyText.mock.resetCalls();
    mockFetchPolicyText.mock.mockImplementation(async () => nextPolicyText);
    mockFormatReturnsInfo.mock.resetCalls();
    mockFormatReturnsInfo.mock.mockImplementation(() => 'formatted-returns-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    returnsCommand(program);

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

  // ── Happy path ──────────────────────────────────────────────────────
  it('fetches order, policy, policy text and calls formatReturnsInfo', async () => {
    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123']);

    assert.equal(mockFetchOrderById.mock.callCount(), 1);
    assert.equal(mockFetchOrderById.mock.calls[0].arguments[0], 'order-uuid-123');

    assert.equal(mockFetchReturnPolicy.mock.callCount(), 1);
    assert.equal(mockFetchReturnPolicy.mock.calls[0].arguments[0], '99991');

    assert.equal(mockFetchPolicyText.mock.callCount(), 1);
    assert.equal(mockFetchPolicyText.mock.calls[0].arguments[0], testPolicy.embedUrl);

    assert.equal(mockFormatReturnsInfo.mock.callCount(), 1);
    assert.deepEqual(mockFormatReturnsInfo.mock.calls[0].arguments[0], testOrder);
    assert.deepEqual(mockFormatReturnsInfo.mock.calls[0].arguments[1], testPolicy);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[2], testPolicyText);

    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'formatted-returns-output');
  });

  // ── --json output ───────────────────────────────────────────────────
  it('outputs JSON with all fields when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.equal(parsed.uuid, 'order-uuid-123');
    assert.equal(parsed.name, 'Order #1001');
    assert.equal(parsed.shop, 'Cool Store');
    assert.deepEqual(parsed.lineItems, testOrder.lineItems.nodes);
    assert.equal(parsed.startReturnUrl, 'https://coolstore.myshopify.com/returns/start/123');
    assert.equal(parsed.statusPageUrl, 'https://coolstore.myshopify.com/status/123');
    assert.deepEqual(parsed.returnPolicy, testPolicy);
    assert.equal(parsed.returnPolicyText, testPolicyText);

    assert.equal(mockFormatReturnsInfo.mock.callCount(), 0);
  });

  // ── Order not found ─────────────────────────────────────────────────
  it('prints error and exits 1 when order is not found', async () => {
    nextOrder = null;
    mockFetchOrderById.mock.mockImplementation(async () => nextOrder);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'returns', 'nonexistent']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      call => call.arguments[0].includes('Order not found'),
    ));
  });

  // ── No productId in lineItems ───────────────────────────────────────
  it('skips policy fetch when no lineItem has shopifyProductId', async () => {
    nextOrder = { ...testOrder, lineItems: { nodes: [{ title: 'Widget' }, { title: 'Gadget' }] } };
    mockFetchOrderById.mock.mockImplementation(async () => nextOrder);

    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123']);

    assert.equal(mockFetchReturnPolicy.mock.callCount(), 0);
    assert.equal(mockFetchPolicyText.mock.callCount(), 0);

    assert.equal(mockFormatReturnsInfo.mock.callCount(), 1);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[1], null);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[2], null);
  });

  // ── Policy has no embedUrl ──────────────────────────────────────────
  it('skips fetchPolicyText when policy has no embedUrl', async () => {
    nextPolicy = { returnDays: 30 };
    mockFetchReturnPolicy.mock.mockImplementation(async () => nextPolicy);

    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123']);

    assert.equal(mockFetchReturnPolicy.mock.callCount(), 1);
    assert.equal(mockFetchPolicyText.mock.callCount(), 0);

    assert.equal(mockFormatReturnsInfo.mock.callCount(), 1);
    assert.deepEqual(mockFormatReturnsInfo.mock.calls[0].arguments[1], nextPolicy);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[2], null);
  });

  // ── fetchReturnPolicy returns null ──────────────────────────────────
  it('skips fetchPolicyText when fetchReturnPolicy returns null', async () => {
    nextPolicy = null;
    mockFetchReturnPolicy.mock.mockImplementation(async () => nextPolicy);

    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123']);

    assert.equal(mockFetchReturnPolicy.mock.callCount(), 1);
    assert.equal(mockFetchPolicyText.mock.callCount(), 0);

    assert.equal(mockFormatReturnsInfo.mock.callCount(), 1);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[1], null);
    assert.equal(mockFormatReturnsInfo.mock.calls[0].arguments[2], null);
  });

  // ── API error ───────────────────────────────────────────────────────
  it('prints error and exits 1 when fetchOrderById throws', async () => {
    mockFetchOrderById.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'returns', 'order-uuid-123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      call => call.arguments[0].includes('Network failure'),
    ));
  });

  // ── --json with null policy ─────────────────────────────────────────
  it('outputs null returnPolicy and returnPolicyText in JSON when policy is null', async () => {
    nextPolicy = null;
    mockFetchReturnPolicy.mock.mockImplementation(async () => nextPolicy);

    await program.parseAsync(['node', 'test', 'returns', 'order-uuid-123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.equal(parsed.returnPolicy, null);
    assert.equal(parsed.returnPolicyText, null);
  });
});
