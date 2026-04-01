import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

const fetchOrdersMock = mock.fn(async () => [{ uuid: '1' }, { uuid: '2' }]);
const filterOrdersMock = mock.fn((orders) => orders);
const formatSpendingMock = mock.fn(() => 'spending-output');

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchOrders: fetchOrdersMock,
    filterOrders: filterOrdersMock,
  },
});

mock.module('../../lib/formatter.mjs', {
  namedExports: {
    formatSpending: formatSpendingMock,
  },
});

const { spendingCommand } = await import('../../lib/commands/spending.mjs');

describe('spendingCommand', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    fetchOrdersMock.mock.resetCalls();
    fetchOrdersMock.mock.mockImplementation(async () => [{ uuid: '1' }, { uuid: '2' }]);
    filterOrdersMock.mock.resetCalls();
    filterOrdersMock.mock.mockImplementation((orders) => orders);
    formatSpendingMock.mock.resetCalls();
    formatSpendingMock.mock.mockImplementation(() => 'spending-output');

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    spendingCommand(program);

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

  // -- Happy path (no filters) -----------------------------------------------
  it('fetches all orders, formats spending, and prints result', async () => {
    await program.parseAsync(['node', 'test', 'spending']);

    assert.equal(fetchOrdersMock.mock.callCount(), 1);
    assert.deepEqual(fetchOrdersMock.mock.calls[0].arguments[0], { allPages: true });
    assert.equal(formatSpendingMock.mock.callCount(), 1);
    assert.deepEqual(formatSpendingMock.mock.calls[0].arguments[0], [{ uuid: '1' }, { uuid: '2' }]);
    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'spending-output');
  });

  // -- --since filter ---------------------------------------------------------
  it('calls filterOrders with since when --since is provided', async () => {
    await program.parseAsync(['node', 'test', 'spending', '--since', '2025-01-01']);

    assert.equal(filterOrdersMock.mock.callCount(), 1);
    const [orders, opts] = filterOrdersMock.mock.calls[0].arguments;
    assert.deepEqual(orders, [{ uuid: '1' }, { uuid: '2' }]);
    assert.equal(opts.since, '2025-01-01');
  });

  // -- --until filter ---------------------------------------------------------
  it('calls filterOrders with until when --until is provided', async () => {
    await program.parseAsync(['node', 'test', 'spending', '--until', '2025-03-01']);

    assert.equal(filterOrdersMock.mock.callCount(), 1);
    const [, opts] = filterOrdersMock.mock.calls[0].arguments;
    assert.equal(opts.until, '2025-03-01');
  });

  // -- --since and --until together -------------------------------------------
  it('passes both since and until to filterOrders', async () => {
    await program.parseAsync(['node', 'test', 'spending', '--since', '2025-01-01', '--until', '2025-03-01']);

    assert.equal(filterOrdersMock.mock.callCount(), 1);
    const [, opts] = filterOrdersMock.mock.calls[0].arguments;
    assert.equal(opts.since, '2025-01-01');
    assert.equal(opts.until, '2025-03-01');
  });

  // -- No date filters: filterOrders NOT called -------------------------------
  it('does not call filterOrders when no date filters are given', async () => {
    await program.parseAsync(['node', 'test', 'spending']);

    assert.equal(filterOrdersMock.mock.callCount(), 0);
  });

  // -- Invalid --since date ---------------------------------------------------
  it('prints error and exits 1 for invalid --since date', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'spending', '--since', 'not-a-date']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Invalid date for --since: "not-a-date"'),
      ),
    );
  });

  // -- Invalid --until date ---------------------------------------------------
  it('prints error and exits 1 for invalid --until date', async () => {
    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'spending', '--until', 'not-a-date']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(
      errorMock.mock.calls.some(
        (call) => call.arguments[0].includes('Invalid date for --until: "not-a-date"'),
      ),
    );
  });

  // -- fetchOrders throws -----------------------------------------------------
  it('prints error and exits 1 when fetchOrders throws', async () => {
    fetchOrdersMock.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'spending']),
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
