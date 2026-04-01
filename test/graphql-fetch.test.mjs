import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set up auth mock BEFORE importing graphql — this is critical for ESM
mock.module('../lib/auth.mjs', {
  namedExports: {
    getValidToken: async () => ({ accessToken: 'test-token', userinfo: { email: 'test@example.com' } }),
  },
});

const { fetchOrders } = await import('../lib/graphql.mjs');

function makePage(nodes, hasNextPage = false, endCursor = null) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: {
        ordersList: {
          pageInfo: { hasNextPage, endCursor },
          nodes,
        },
      },
    }),
  };
}

describe('fetchOrders', () => {
  afterEach(() => {
    globalThis.fetch?.mock?.resetCalls?.();
    mock.restoreAll();
    // Re-apply auth mock after restoreAll
    mock.module('../lib/auth.mjs', {
      namedExports: {
        getValidToken: async () => ({ accessToken: 'test-token', userinfo: { email: 'test@example.com' } }),
      },
    });
  });

  it('returns orders from a single page', async () => {
    const orders = [{ uuid: '1', __typename: 'Order' }, { uuid: '2', __typename: 'Order' }];
    mock.method(globalThis, 'fetch', async () => makePage(orders));

    const result = await fetchOrders({ limit: 10 });
    assert.equal(result.length, 2);
  });

  it('paginates when allPages is true', async () => {
    const page1 = [{ uuid: '1' }];
    const page2 = [{ uuid: '2' }];
    let callCount = 0;
    mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) return makePage(page1, true, 'cursor-1');
      return makePage(page2, false);
    });

    const result = await fetchOrders({ allPages: true, limit: 50 });
    assert.equal(result.length, 2);
    assert.equal(callCount, 2);
  });

  it('truncates to limit', async () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({ uuid: `${i}` }));
    mock.method(globalThis, 'fetch', async () => makePage(orders));

    const result = await fetchOrders({ limit: 3 });
    assert.equal(result.length, 3);
  });

  it('throws on HTTP error', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await assert.rejects(() => fetchOrders(), /GraphQL request failed: 500/);
  });

  it('throws on GraphQL error', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({
        errors: [{ message: 'Unauthorized' }],
      }),
    }));

    await assert.rejects(() => fetchOrders(), /GraphQL error: Unauthorized/);
  });

  it('sends correct headers', async () => {
    let capturedHeaders;
    mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedHeaders = opts.headers;
      return makePage([]);
    });

    await fetchOrders();
    assert.equal(capturedHeaders.Authorization, 'Bearer test-token');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });
});
