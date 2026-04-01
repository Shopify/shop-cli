import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

let nextOrders = [{ uuid: '1' }, { uuid: '2' }];
let nextOrderById = { __typename: 'Order', uuid: 'order-123', name: 'Order #1001' };
let nextFilteredOrders = null; // null means use default passthrough

const mockGetValidToken = mock.fn(async () => ({ accessToken: 'tok', userinfo: { email: 'test@example.com' } }));
const mockFetchOrders = mock.fn(async () => nextOrders);
const mockFetchOrderById = mock.fn(async () => nextOrderById);
const mockFilterOrders = mock.fn((orders, opts) => nextFilteredOrders ?? orders);
const mockFormatOrdersTable = mock.fn(() => 'orders-table');
const mockFormatOrderDetail = mock.fn(() => 'order-detail');
const mockFormatTrackerDetail = mock.fn(() => 'tracker-detail');
const mockIsTracker = mock.fn(() => false);

mock.module('../../lib/auth.mjs', {
  namedExports: {
    getValidToken: mockGetValidToken,
  },
});

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchOrders: mockFetchOrders,
    fetchOrderById: mockFetchOrderById,
    filterOrders: mockFilterOrders,
    VALID_STATUSES: ['PAID', 'FULFILLED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ATTEMPTED_DELIVERY', 'REFUNDED'],
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatOrdersTable: mockFormatOrdersTable,
    formatOrderDetail: mockFormatOrderDetail,
    formatTrackerDetail: mockFormatTrackerDetail,
    isTracker: mockIsTracker,
  },
});

const { ordersCommand } = await import('../../lib/commands/orders.mjs');

describe('orders command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextOrders = [{ uuid: '1' }, { uuid: '2' }];
    nextOrderById = { __typename: 'Order', uuid: 'order-123', name: 'Order #1001' };
    nextFilteredOrders = null;

    mockGetValidToken.mock.resetCalls();
    mockGetValidToken.mock.mockImplementation(async () => ({ accessToken: 'tok', userinfo: { email: 'test@example.com' } }));
    mockFetchOrders.mock.resetCalls();
    mockFetchOrders.mock.mockImplementation(async () => nextOrders);
    mockFetchOrderById.mock.resetCalls();
    mockFetchOrderById.mock.mockImplementation(async () => nextOrderById);
    mockFilterOrders.mock.resetCalls();
    mockFilterOrders.mock.mockImplementation((orders, opts) => nextFilteredOrders ?? orders);
    mockFormatOrdersTable.mock.resetCalls();
    mockFormatOrdersTable.mock.mockImplementation(() => 'orders-table');
    mockFormatOrderDetail.mock.resetCalls();
    mockFormatOrderDetail.mock.mockImplementation(() => 'order-detail');
    mockFormatTrackerDetail.mock.resetCalls();
    mockFormatTrackerDetail.mock.mockImplementation(() => 'tracker-detail');
    mockIsTracker.mock.resetCalls();
    mockIsTracker.mock.mockImplementation(() => false);

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    ordersCommand(program);

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

  // ── orders: happy path ──────────────────────────────────────────────
  it('prints formatted orders table', async () => {
    await program.parseAsync(['node', 'test', 'orders']);

    assert.equal(mockFetchOrders.mock.callCount(), 1);
    assert.deepEqual(mockFetchOrders.mock.calls[0].arguments[0], { limit: 20, allPages: false });
    assert.equal(mockFormatOrdersTable.mock.callCount(), 1);
    assert.deepEqual(mockFormatOrdersTable.mock.calls[0].arguments[0], [{ uuid: '1' }, { uuid: '2' }]);
    assert.equal(mockFormatOrdersTable.mock.calls[0].arguments[1], 'test@example.com');
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'orders-table');
  });

  // ── orders: --json ──────────────────────────────────────────────────
  it('outputs JSON array when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'orders', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(parsed, [{ uuid: '1' }, { uuid: '2' }]);
    assert.equal(mockFormatOrdersTable.mock.callCount(), 0);
  });

  // ── orders: --since filter ──────────────────────────────────────────
  it('fetches with limit:100 and allPages:true when --since is provided', async () => {
    await program.parseAsync(['node', 'test', 'orders', '--since', '2025-01-01']);

    assert.equal(mockFetchOrders.mock.callCount(), 1);
    assert.deepEqual(mockFetchOrders.mock.calls[0].arguments[0], { limit: 100, allPages: true });
    assert.equal(mockFilterOrders.mock.callCount(), 1);
    const [, filterOpts] = mockFilterOrders.mock.calls[0].arguments;
    assert.equal(filterOpts.since, '2025-01-01');
  });

  // ── orders: --status filter ─────────────────────────────────────────
  it('fetches with limit:100 when --status is provided', async () => {
    await program.parseAsync(['node', 'test', 'orders', '--status', 'delivered']);

    assert.equal(mockFetchOrders.mock.callCount(), 1);
    assert.deepEqual(mockFetchOrders.mock.calls[0].arguments[0], { limit: 100, allPages: true });
    assert.equal(mockFilterOrders.mock.callCount(), 1);
    const [, filterOpts] = mockFilterOrders.mock.calls[0].arguments;
    assert.equal(filterOpts.status, 'delivered');
  });

  // ── orders: invalid --since date ────────────────────────────────────
  it('prints error and exits 1 for invalid --since date', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'orders', '--since', 'not-a-date']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Invalid date for --since: "not-a-date"'),
      ),
    );
  });

  // ── orders: invalid --status ────────────────────────────────────────
  it('prints error with valid statuses list for invalid --status', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'orders', '--status', 'bogus']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Unknown status "bogus"') &&
                  call.arguments[0].includes('Valid statuses:'),
      ),
    );
  });

  // ── orders: invalid --limit ─────────────────────────────────────────
  it('prints error and exits 1 for invalid --limit', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'orders', '--limit', '0']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Limit must be a positive number'),
      ),
    );
  });

  // ── orders: fetchOrders throws ──────────────────────────────────────
  it('prints error and exits 1 when fetchOrders throws', async () => {
    mockFetchOrders.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'orders']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Network failure'),
      ),
    );
  });
});

describe('order <id> command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextOrderById = { __typename: 'Order', uuid: 'order-123', name: 'Order #1001' };

    mockFetchOrderById.mock.resetCalls();
    mockFetchOrderById.mock.mockImplementation(async () => nextOrderById);
    mockIsTracker.mock.resetCalls();
    mockIsTracker.mock.mockImplementation(() => false);
    mockFormatOrderDetail.mock.resetCalls();
    mockFormatOrderDetail.mock.mockImplementation(() => 'order-detail');
    mockFormatTrackerDetail.mock.resetCalls();
    mockFormatTrackerDetail.mock.mockImplementation(() => 'tracker-detail');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    ordersCommand(program);

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

  // ── order: happy path with Order ────────────────────────────────────
  it('calls formatOrderDetail for an Order', async () => {
    await program.parseAsync(['node', 'test', 'order', 'order-123']);

    assert.equal(mockFetchOrderById.mock.callCount(), 1);
    assert.equal(mockFetchOrderById.mock.calls[0].arguments[0], 'order-123');
    assert.equal(mockFormatOrderDetail.mock.callCount(), 1);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'order-detail');
  });

  // ── order: happy path with Tracker ──────────────────────────────────
  it('calls formatTrackerDetail when isTracker returns true', async () => {
    nextOrderById = { __typename: 'Tracker', id: 'tracker-456', name: 'My Package' };
    mockFetchOrderById.mock.mockImplementation(async () => nextOrderById);
    mockIsTracker.mock.mockImplementation(() => true);

    await program.parseAsync(['node', 'test', 'order', 'tracker-456']);

    assert.equal(mockFormatTrackerDetail.mock.callCount(), 1);
    assert.equal(mockFormatOrderDetail.mock.callCount(), 0);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'tracker-detail');
  });

  // ── order: --json ───────────────────────────────────────────────────
  it('outputs JSON when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'order', 'order-123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(parsed, { __typename: 'Order', uuid: 'order-123', name: 'Order #1001' });
    assert.equal(mockFormatOrderDetail.mock.callCount(), 0);
  });

  // ── order: not found ────────────────────────────────────────────────
  it('prints error and exits 1 when order is not found', async () => {
    mockFetchOrderById.mock.mockImplementation(async () => null);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'order', 'nonexistent']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('not found'),
      ),
    );
  });
});
