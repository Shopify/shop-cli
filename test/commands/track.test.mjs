import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

const sampleOrder = {
  __typename: 'Order',
  uuid: 'order-uuid-123',
  name: 'Order #1001',
  deliveryStatus: 'DELIVERED',
  displayStatus: 'Delivered',
  etaInfo: { formattedEta: 'Mar 5', estimatedTimeOfDelivery: '2025-03-05T00:00:00Z' },
  trackers: { nodes: [{ trackingCode: '1Z999AA10123456784', trackingUrl: 'https://track.example.com/1Z999AA10123456784', status: 'DELIVERED', carrierInfo: { name: 'UPS' }, etaInfo: { formattedEta: 'Mar 5' } }] },
  statusPageUrl: 'https://coolstore.myshopify.com/status/123',
};

const sampleTracker = {
  __typename: 'Tracker',
  id: 'tracker-id-789',
  name: 'My Package',
  status: 'IN_TRANSIT',
};

// Create stable mock functions that persist across tests
const fetchOrderByIdMock = mock.fn();
const isTrackerMock = mock.fn();
const formatTrackingDetailMock = mock.fn(() => 'tracking-detail-output');
const formatTrackerDetailMock = mock.fn(() => 'tracker-detail-output');

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchOrderById: fetchOrderByIdMock,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    isTracker: isTrackerMock,
    formatTrackingDetail: formatTrackingDetailMock,
    formatTrackerDetail: formatTrackerDetailMock,
  },
});

const { trackCommand } = await import('../../lib/commands/track.mjs');

describe('track command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    fetchOrderByIdMock.mock.resetCalls();
    isTrackerMock.mock.resetCalls();
    formatTrackingDetailMock.mock.resetCalls();
    formatTrackerDetailMock.mock.resetCalls();

    // Reset implementations to defaults
    fetchOrderByIdMock.mock.mockImplementation(async () => sampleOrder);
    isTrackerMock.mock.mockImplementation(() => false);
    formatTrackingDetailMock.mock.mockImplementation(() => 'tracking-detail-output');
    formatTrackerDetailMock.mock.mockImplementation(() => 'tracker-detail-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    trackCommand(program);

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

  // ── Happy path: Order ────────────────────────────────────────────────
  it('prints formatted tracking detail for an order', async () => {
    await program.parseAsync(['node', 'test', 'track', 'order-uuid-123']);

    assert.equal(formatTrackingDetailMock.mock.callCount(), 1);
    assert.deepEqual(formatTrackingDetailMock.mock.calls[0].arguments[0], sampleOrder);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'tracking-detail-output');
  });

  // ── Happy path: Tracker ──────────────────────────────────────────────
  it('prints formatted tracker detail for a tracker', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => sampleTracker);
    isTrackerMock.mock.mockImplementation(() => true);

    await program.parseAsync(['node', 'test', 'track', 'tracker-id-789']);

    assert.equal(formatTrackerDetailMock.mock.callCount(), 1);
    assert.deepEqual(formatTrackerDetailMock.mock.calls[0].arguments[0], sampleTracker);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'tracker-detail-output');
  });

  // ── --json with Order ────────────────────────────────────────────────
  it('outputs JSON with selected fields for an order when --json is passed', async () => {
    await program.parseAsync(['node', 'test', 'track', 'order-uuid-123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.equal(parsed.uuid, 'order-uuid-123');
    assert.equal(parsed.name, 'Order #1001');
    assert.equal(parsed.deliveryStatus, 'DELIVERED');
    assert.equal(parsed.displayStatus, 'Delivered');
    assert.deepEqual(parsed.etaInfo, sampleOrder.etaInfo);
    assert.deepEqual(parsed.trackers, sampleOrder.trackers.nodes);
    assert.equal(parsed.statusPageUrl, 'https://coolstore.myshopify.com/status/123');
    assert.equal(formatTrackingDetailMock.mock.callCount(), 0);
  });

  // ── --json with Tracker ──────────────────────────────────────────────
  it('outputs JSON.stringify of the tracker item directly when --json is passed', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => sampleTracker);
    isTrackerMock.mock.mockImplementation(() => true);

    await program.parseAsync(['node', 'test', 'track', 'tracker-id-789', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(parsed, sampleTracker);
    assert.equal(formatTrackerDetailMock.mock.callCount(), 0);
  });

  // ── Not found ────────────────────────────────────────────────────────
  it('prints not-found message and exits 1 when fetchOrderById returns null', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => null);

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'track', 'nonexistent']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      call => call.arguments[0].includes('not found'),
    ));
  });

  // ── API error ────────────────────────────────────────────────────────
  it('prints error message and exits 1 when fetchOrderById throws', async () => {
    fetchOrderByIdMock.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'track', 'order-uuid-123']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      call => call.arguments[0].includes('Network failure'),
    ));
  });

  // ── Order with missing trackers ──────────────────────────────────────
  it('outputs empty trackers array in JSON when order has no trackers', async () => {
    const orderNoTrackers = { ...sampleOrder, trackers: undefined };
    fetchOrderByIdMock.mock.mockImplementation(async () => orderNoTrackers);

    await program.parseAsync(['node', 'test', 'track', 'order-uuid-123', '--json']);

    assert.equal(logMock.mock.callCount(), 1);
    const parsed = JSON.parse(logMock.mock.calls[0].arguments[0]);
    assert.deepEqual(parsed.trackers, []);
  });
});
