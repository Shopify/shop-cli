import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

const mockFetchShopPolicies = mock.fn(async () => new Map());

mock.module('../../lib/graphql.mjs', {
  namedExports: {
    fetchShopPolicies: mockFetchShopPolicies,
  },
});

const { shippingCommand } = await import('../../lib/commands/shipping.mjs');

describe('shipping command', () => {
  let program;
  let logMock;
  let errorMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;
    mockFetchShopPolicies.mock.resetCalls();
    mockFetchShopPolicies.mock.mockImplementation(async () => new Map());

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    shippingCommand(program);

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

  it('prints shipping policy text when available', async () => {
    const policyMap = new Map([['example.com', {
      shippingPolicyText: 'Free shipping on orders over $50',
      shippingPolicyUrl: 'https://example.com/policies/shipping-policy',
    }]]);
    mockFetchShopPolicies.mock.mockImplementation(async () => policyMap);

    await program.parseAsync(['node', 'test', 'shipping', 'example.com']);

    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'Free shipping on orders over $50');
  });

  it('prints shipping policy URL when text is null', async () => {
    const policyMap = new Map([['example.com', {
      shippingPolicyText: null,
      shippingPolicyUrl: 'https://example.com/policies/shipping-policy',
    }]]);
    mockFetchShopPolicies.mock.mockImplementation(async () => policyMap);

    await program.parseAsync(['node', 'test', 'shipping', 'example.com']);

    assert.equal(logMock.mock.callCount(), 1);
    assert.equal(logMock.mock.calls[0].arguments[0], 'https://example.com/policies/shipping-policy');
  });

  it('prints no-policy message when domain has no policy', async () => {
    mockFetchShopPolicies.mock.mockImplementation(async () => new Map());

    await program.parseAsync(['node', 'test', 'shipping', 'nopolicy.com']);

    assert.equal(logMock.mock.callCount(), 1);
    assert.ok(logMock.mock.calls[0].arguments[0].includes('No shipping policy found'));
    assert.ok(logMock.mock.calls[0].arguments[0].includes('nopolicy.com'));
  });

  it('prints error and exits 1 when fetchShopPolicies throws', async () => {
    mockFetchShopPolicies.mock.mockImplementation(async () => {
      throw new Error('Network failure');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'test', 'shipping', 'broken.com']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(errorMock.mock.calls.some(
      (call) => call.arguments[0].includes('Network failure'),
    ));
  });
});
