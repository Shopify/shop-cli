import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { checkoutCommand } from '../../lib/commands/checkout.mjs';

describe('checkout command', () => {
  let program;
  let logOutput;
  let errOutput;
  let exitCode;

  beforeEach(() => {
    logOutput = [];
    errOutput = [];
    exitCode = undefined;

    mock.method(console, 'log', (...args) => logOutput.push(args.join(' ')));
    mock.method(console, 'error', (...args) => errOutput.push(args.join(' ')));
    mock.method(process, 'exit', (code) => {
      exitCode = code;
      throw new Error('process.exit');
    });

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    checkoutCommand(program);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ── Happy path ──────────────────────────────────────────────────────
  it('builds correct URL for single item with quantity', async () => {
    await program.parseAsync(['checkout', '12345:2', '--store', 'https://example.myshopify.com'], { from: 'user' });
    assert.equal(logOutput.length, 1);
    assert.equal(logOutput[0], 'https://example.myshopify.com/cart/12345:2');
  });

  // ── Multiple items ──────────────────────────────────────────────────
  it('builds correct URL for multiple items', async () => {
    await program.parseAsync(['checkout', '12345:2', '67890:1', '--store', 'https://example.myshopify.com'], { from: 'user' });
    assert.equal(logOutput.length, 1);
    assert.equal(logOutput[0], 'https://example.myshopify.com/cart/12345:2,67890:1');
  });

  // ── Default quantity ────────────────────────────────────────────────
  it('defaults quantity to 1 when not specified', async () => {
    await program.parseAsync(['checkout', '12345', '--store', 'https://example.myshopify.com'], { from: 'user' });
    assert.equal(logOutput.length, 1);
    assert.equal(logOutput[0], 'https://example.myshopify.com/cart/12345:1');
  });

  // ── Query params ────────────────────────────────────────────────────
  it('adds email, city, and country as query params', async () => {
    await program.parseAsync([
      'checkout', '12345:1',
      '--store', 'https://example.myshopify.com',
      '--email', 'user@example.com',
      '--city', 'Toronto',
      '--country', 'CA',
    ], { from: 'user' });

    assert.equal(logOutput.length, 1);
    const url = new URL(logOutput[0]);
    assert.equal(url.searchParams.get('checkout[email]'), 'user@example.com');
    assert.equal(url.searchParams.get('checkout[shipping_address][city]'), 'Toronto');
    assert.equal(url.searchParams.get('checkout[shipping_address][country]'), 'CA');
  });

  // ── Non-numeric variant ID ──────────────────────────────────────────
  it('prints error and exits 1 for non-numeric variant ID', async () => {
    await assert.rejects(
      () => program.parseAsync(['checkout', 'abc:2', '--store', 'https://example.myshopify.com'], { from: 'user' }),
      { message: 'process.exit' },
    );
    assert.equal(exitCode, 1);
    assert.ok(errOutput.some(msg => msg.includes('Invalid variant ID "abc"')));
  });

  // ── Invalid quantity: zero ──────────────────────────────────────────
  it('prints error and exits 1 for zero quantity', async () => {
    await assert.rejects(
      () => program.parseAsync(['checkout', '12345:0', '--store', 'https://example.myshopify.com'], { from: 'user' }),
      { message: 'process.exit' },
    );
    assert.equal(exitCode, 1);
    assert.ok(errOutput.some(msg => msg.includes('Invalid quantity "0"')));
  });

  // ── Invalid quantity: non-numeric ───────────────────────────────────
  it('prints error and exits 1 for non-numeric quantity', async () => {
    await assert.rejects(
      () => program.parseAsync(['checkout', '12345:abc', '--store', 'https://example.myshopify.com'], { from: 'user' }),
      { message: 'process.exit' },
    );
    assert.equal(exitCode, 1);
    assert.ok(errOutput.some(msg => msg.includes('Invalid quantity "abc"')));
  });

  // ── Missing --store ─────────────────────────────────────────────────
  it('throws CommanderError when --store is missing', async () => {
    await assert.rejects(
      () => program.parseAsync(['checkout', '12345:1'], { from: 'user' }),
      (err) => {
        assert.equal(err.constructor.name, 'CommanderError');
        return true;
      },
    );
  });
});
