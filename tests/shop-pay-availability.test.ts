import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import { ACCESS_TOKEN_ACCOUNT, DEVICE_ID_ACCOUNT } from '../src/constants.js'
import { createFetchMock, createStore, jsonResponse, stdinFrom } from './test-utils.js'

const MCP_URL = 'https://example.myshopify.com/api/ucp/mcp'
const BUDGET_URL = 'https://shop.app/pay/agents/payment_tokens'

async function runCreate(opts: {
  checkout: Record<string, unknown>
  budget?: Response
}): Promise<{ out: string; urls: string[] }> {
  const { createProgram } = await import('../src/cli.js')
  const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access', [DEVICE_ID_ACCOUNT]: 'device-1' })
  const stdout = { write: fn() }
  const stderr = { write: fn() }
  const urls: string[] = []
  const fetchMock = createFetchMock(async (url) => {
    urls.push(url)
    if (url.endsWith('/userinfo')) return jsonResponse({ sub: 'user-1' })
    if (url === 'https://shop.app/oauth/token') return jsonResponse({ access_token: 'ucp-jwt' })
    if (url === 'https://api.ipify.org?format=json') return jsonResponse({ ip: '203.0.113.10' })
    if (url === BUDGET_URL) return opts.budget ?? jsonResponse({ payment_tokens: [] })
    if (url === MCP_URL) {
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: opts.checkout } })
    }
    throw new Error(`Unexpected URL ${url}`)
  })

  await createProgram({
    fetch: fetchMock,
    store,
    stdout,
    stderr,
    stdin: stdinFrom('{"email":"buyer@example.com"}'),
    exit: ((code: number) => {
      throw new Error(`exit ${code}`)
    }) as never,
  }).parseAsync([
    'node',
    'shop',
    'checkout',
    'create',
    '--shop-domain',
    'example.myshopify.com',
    '--variant-id',
    '123',
    '--checkout-stdin',
  ])

  expect(stderr.write).not.toHaveBeenCalled()
  const out = (stdout.write.mock.calls as { arguments: unknown[] }[])
    .map((call) => String(call.arguments[0]))
    .join('')
  return { out, urls }
}

describe('shop_pay_availability annotation on checkout create', () => {
  it('annotates that the store does not accept Shop agent payments when a budget exists', async () => {
    const { out } = await runCreate({
      checkout: { id: 'checkout-1', status: 'ready_for_complete', payment: { instruments: [] } },
      budget: jsonResponse({
        payment_tokens: [
          { id: 'shop_secret', default_currency_code: 'USD', display: { limit: 10000, remaining_amount: 5000, renewal_type: 'monthly', renews_at: null } },
        ],
        has_more: false,
        next_cursor: null,
      }),
    })

    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    expect(parsed.shop_pay_availability).toEqual({
      budget_available: true,
      message: expect.stringContaining("doesn't accept Shop agent payments"),
    })
    expect(parsed.id).toBe('checkout-1')
    expect(out).not.toContain('shop_secret')
  })

  it('annotates an offer-a-budget hint when instruments are empty and no budget is set', async () => {
    const { out } = await runCreate({
      checkout: { id: 'checkout-1', status: 'ready_for_complete', payment: { instruments: [] } },
      budget: jsonResponse({ payment_tokens: [], has_more: false, next_cursor: null }),
    })

    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    expect(parsed.shop_pay_availability).toEqual({
      budget_available: false,
      message: expect.stringContaining('set up a budget'),
    })
  })

  it('treats a 403 (missing payment scope) as no budget', async () => {
    const { out } = await runCreate({
      checkout: { id: 'checkout-1', status: 'ready_for_complete', payment: { instruments: [] } },
      budget: jsonResponse(
        { messages: [{ type: 'error', code: 'invalid_scope', content: 'Access token does not have the required scope.' }] },
        { status: 403 },
      ),
    })

    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    expect(parsed.shop_pay_availability.budget_available).toBe(false)
  })

  it('does not probe the budget endpoint when instruments are present', async () => {
    const { out, urls } = await runCreate({
      checkout: {
        id: 'checkout-1',
        status: 'ready_for_complete',
        payment: { instruments: [{ id: 'shop_tok', handler_id: 'shop_pay', type: 'shop_pay' }] },
      },
    })

    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    expect(parsed).not.toHaveProperty('shop_pay_availability')
    expect(urls).not.toContain(BUDGET_URL)
  })
})
