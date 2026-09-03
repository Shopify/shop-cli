import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import { createProgram } from '../src/cli.js'
import { CLI_VERSION, GLOBAL_CATALOG_MCP_URL, UCP_VERSION } from '../src/constants.js'
import { ShopCatalogClient } from '../src/shop-client.js'
import {
  classifyUcpVersion,
  describeMcpError,
  isUnknownToolError,
  negotiatedVersionNotice,
  parseManifestVersions,
  UPDATE_HINT,
} from '../src/ucp-version.js'
import { createFetchMock, createStore, jsonResponse } from './test-utils.js'

const CATALOG_MANIFEST_URL = 'https://catalog.shopify.com/.well-known/ucp'
const MERCHANT_MANIFEST_URL = 'https://example.myshopify.com/.well-known/ucp'
const OLDER = '2026-04-08'
const NEWER = '2027-01-15'
const UPDATE_COMMAND = 'npm install --global @shopify/shop-cli@latest'

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response

function manifest(version: string, supported: string[]): Record<string, unknown> {
  return {
    ucp: {
      version,
      supported_versions: Object.fromEntries(supported.map((v) => [v, `https://catalog.shopify.com/.well-known/ucp/${v}`])),
    },
  }
}

function mcpResult(structuredContent: Record<string, unknown>): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent } })
}

function mcpError(error: Record<string, unknown>): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, error })
}

function joinWrites(writer: { write: ReturnType<typeof fn> }): string {
  return (writer.write.mock.calls as { arguments: unknown[] }[]).map((call) => String(call.arguments[0])).join('')
}

async function runCli(args: string[], handler: Handler) {
  const stdout = { write: fn() }
  const stderr = { write: fn() }
  const urls: string[] = []
  const inits: RequestInit[] = []
  let exitCode: number | undefined
  const fetchMock = createFetchMock(async (url, init) => {
    urls.push(url)
    inits.push(init)
    return handler(url, init)
  })

  try {
    await createProgram({
      fetch: fetchMock,
      store: createStore({}),
      stdout,
      stderr,
      exit: ((code: number) => {
        exitCode = code
        throw new Error(`exit ${code}`)
      }) as never,
    }).parseAsync(['node', 'shop', ...args])
  } catch (error) {
    if (!String(error).includes('exit ')) throw error
  }

  return { out: joinWrites(stdout), err: joinWrites(stderr), urls, inits, exitCode }
}

function parseJson(out: string): Record<string, unknown> {
  return JSON.parse(out.slice(out.indexOf('{'))) as Record<string, unknown>
}

describe('shop version', () => {
  it('prints the CLI and UCP versions without touching the network', async () => {
    const { out, err, urls, exitCode } = await runCli(['version'], () => {
      throw new Error('no network expected')
    })
    expect(exitCode).toBeUndefined()
    expect(err).toBe('')
    expect(urls).toEqual([])
    expect(parseJson(out)).toEqual({ cli: CLI_VERSION, ucp: UCP_VERSION })
  })

  it('--check reads the global catalog manifest and reports current when it matches', async () => {
    const { out, urls, inits, exitCode } = await runCli(['version', '--check'], (url) => {
      if (url === CATALOG_MANIFEST_URL) return jsonResponse(manifest(UCP_VERSION, [OLDER]))
      throw new Error(`Unexpected URL ${url}`)
    })
    expect(exitCode).toBeUndefined()
    expect(urls).toEqual([CATALOG_MANIFEST_URL])
    expect((inits[0].headers as Record<string, string>)['User-Agent']).toBe(`shop-cli/${CLI_VERSION}`)
    expect(parseJson(out)).toMatchObject({
      cli: CLI_VERSION,
      ucp: UCP_VERSION,
      check: {
        host: 'catalog.shopify.com',
        manifest_url: CATALOG_MANIFEST_URL,
        cli_ucp_version: UCP_VERSION,
        server_version: UCP_VERSION,
        supported_versions: [UCP_VERSION, OLDER],
        status: 'current',
      },
    })
  })

  it('--check reports outdated with an update hint when the server default is newer but still supports us', async () => {
    const { out } = await runCli(['version', '--check'], () => jsonResponse(manifest(NEWER, [UCP_VERSION])))
    const check = parseJson(out).check as Record<string, unknown>
    expect(check.status).toBe('outdated')
    expect(check.server_version).toBe(NEWER)
    expect(check.message).toContain(UPDATE_COMMAND)
  })

  it('--check reports unsupported when the server dropped our release', async () => {
    const { out, exitCode } = await runCli(['version', '--check'], () => jsonResponse(manifest(NEWER, ['2026-12-01'])))
    const check = parseJson(out).check as Record<string, unknown>
    expect(exitCode).toBeUndefined()
    expect(check.status).toBe('unsupported')
    expect(check.message).toContain('no longer supports')
    expect(check.message).toContain(UPDATE_COMMAND)
  })

  it('--check reports unknown instead of failing when the manifest is unavailable', async () => {
    const { out, err, exitCode } = await runCli(['version', '--check'], () => jsonResponse({ error: 'nope' }, { status: 404 }))
    expect(exitCode).toBeUndefined()
    expect(err).toBe('')
    const check = parseJson(out).check as Record<string, unknown>
    expect(check.status).toBe('unknown')
    expect(check.server_version).toBe(null)
    expect(check.message).toContain(CATALOG_MANIFEST_URL)
  })

  it('--shop-domain checks the merchant manifest instead of the catalog', async () => {
    const { out, urls } = await runCli(['version', '--shop-domain', 'example.myshopify.com'], (url) => {
      if (url === MERCHANT_MANIFEST_URL) return jsonResponse(manifest(UCP_VERSION, [OLDER]))
      throw new Error(`Unexpected URL ${url}`)
    })
    expect(urls).toEqual([MERCHANT_MANIFEST_URL])
    const check = parseJson(out).check as Record<string, unknown>
    expect(check.host).toBe('example.myshopify.com')
    expect(check.status).toBe('current')
  })
})

describe('UCP manifest classification', () => {
  it('reports ahead when the server has not adopted our release and updating would not help', () => {
    const check = classifyUcpVersion({ version: OLDER, supported: [OLDER, '2026-01-23'] }, 'shop.example')
    expect(check.status).toBe('ahead')
    expect(check.message).toContain('updating shop-cli will not help')
  })

  it('treats a server whose default is older but which lists our release as current', () => {
    const check = classifyUcpVersion({ version: OLDER, supported: [UCP_VERSION, OLDER] }, 'shop.example')
    expect(check.status).toBe('current')
  })

  it('parses supported_versions as a map or a list and sorts newest first', () => {
    expect(parseManifestVersions(manifest(UCP_VERSION, ['2026-01-23', OLDER]))).toEqual({
      version: UCP_VERSION,
      supported: [UCP_VERSION, OLDER, '2026-01-23'],
    })
    expect(parseManifestVersions({ ucp: { version: UCP_VERSION, supported_versions: [OLDER] } })).toEqual({
      version: UCP_VERSION,
      supported: [UCP_VERSION, OLDER],
    })
    expect(parseManifestVersions({ version: UCP_VERSION })).toEqual({ version: UCP_VERSION, supported: [UCP_VERSION] })
    expect(parseManifestVersions({ ucp: {} })).toBe(null)
    expect(parseManifestVersions('not json')).toBe(null)
  })
})

describe('UCP version drift during MCP calls', () => {
  const search = ['--format', 'json', 'search', 'shoes']

  it('writes a one-time stderr notice when a server negotiates an older UCP release', async () => {
    const { out, err, exitCode } = await runCli(search, (url) => {
      if (url === GLOBAL_CATALOG_MCP_URL) return mcpResult({ ucp: { version: OLDER }, products: [] })
      throw new Error(`Unexpected URL ${url}`)
    })
    expect(exitCode).toBeUndefined()
    expect(err).toContain('# Notice')
    expect(err).toContain(`with UCP ${OLDER}`)
    expect(err).toContain(UCP_VERSION)
    expect(out).toContain('"products"')
  })

  it('stays silent when the negotiated release matches the CLI', async () => {
    const { err } = await runCli(search, () => mcpResult({ ucp: { version: UCP_VERSION }, products: [] }))
    expect(err).toBe('')
  })

  it('reports each host/version mismatch once per client, not once per call', async () => {
    const onNotice = fn()
    const client = new ShopCatalogClient({
      fetch: createFetchMock(async () => mcpResult({ ucp: { version: OLDER }, products: [] })),
      store: createStore({}),
      onNotice,
    })
    await client.searchCatalog({ query: 'shoes' })
    await client.getProduct({ id: 'gid://shopify/Product/1' })
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('explains a Tool not found error as a dropped UCP release, confirmed via the manifest', async () => {
    const { err, urls, exitCode } = await runCli(search, (url) => {
      if (url === GLOBAL_CATALOG_MCP_URL) {
        return mcpError({ code: -32602, message: 'Invalid params', data: 'Tool not found: search_catalog' })
      }
      if (url === CATALOG_MANIFEST_URL) return jsonResponse(manifest(NEWER, ['2026-12-01']))
      throw new Error(`Unexpected URL ${url}`)
    })
    expect(exitCode).toBe(1)
    expect(urls).toEqual([GLOBAL_CATALOG_MCP_URL, CATALOG_MANIFEST_URL])
    expect(err).toContain('# Error')
    expect(err).toContain('MCP search_catalog returned an error: Invalid params: Tool not found: search_catalog')
    expect(err).toContain(`catalog.shopify.com no longer supports UCP ${UCP_VERSION}`)
    expect(err).toContain(UPDATE_COMMAND)
  })

  it('falls back to a generic update hint when the manifest cannot be read', async () => {
    const { err, exitCode } = await runCli(search, (url) => {
      if (url === GLOBAL_CATALOG_MCP_URL) {
        return mcpError({ code: -32602, message: 'Invalid params', data: 'Tool not found: search_catalog' })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    expect(exitCode).toBe(1)
    expect(err).toContain('This usually means catalog.shopify.com no longer accepts')
    expect(err).toContain(UPDATE_COMMAND)
  })

  it('says it is not a version mismatch when the manifest still lists our release', async () => {
    const { err } = await runCli(search, (url) => {
      if (url === GLOBAL_CATALOG_MCP_URL) {
        return mcpError({ code: -32602, message: 'Invalid params', data: 'Tool not found: search_catalog' })
      }
      return jsonResponse(manifest(UCP_VERSION, [OLDER]))
    })
    expect(err).toContain('not a version mismatch')
    expect(err).not.toContain(UPDATE_COMMAND)
  })

  it('points at a custom --profile-url when one is in use and the tool is not found', async () => {
    const { err } = await runCli(['--profile-url', 'https://example.com/agent.json', ...search], (url) => {
      if (url === GLOBAL_CATALOG_MCP_URL) {
        return mcpError({ code: -32602, message: 'Invalid params', data: 'Tool not found: search_catalog' })
      }
      return jsonResponse(manifest(UCP_VERSION, [OLDER]))
    })
    expect(err).toContain('not a version mismatch')
    expect(err).toContain('A custom --profile-url is in use (https://example.com/agent.json)')
  })

  it('surfaces the server message for unrelated MCP errors without fetching the manifest', async () => {
    const { err, urls, exitCode } = await runCli(search, () => mcpError({ code: -32602, message: 'bad input' }))
    expect(exitCode).toBe(1)
    expect(urls).toEqual([GLOBAL_CATALOG_MCP_URL])
    expect(err).toContain('MCP search_catalog returned an error: bad input')
    expect(err).not.toContain(UPDATE_COMMAND)
  })
})

describe('MCP error helpers', () => {
  it('recognizes tool-not-found envelopes by text or JSON-RPC method-not-found code', () => {
    expect(isUnknownToolError({ code: -32602, message: 'Invalid params', data: 'Tool not found: search_catalog' })).toBe(true)
    expect(isUnknownToolError({ code: -32601, message: 'Method not found' })).toBe(true)
    expect(isUnknownToolError({ code: -32602, message: 'Unknown tool: create_checkout' })).toBe(true)
    expect(isUnknownToolError({ code: -32602, message: 'bad input' })).toBe(false)
    expect(isUnknownToolError('Tool not found')).toBe(false)
  })

  it('joins message and data when describing an error', () => {
    expect(describeMcpError({ message: 'Invalid params', data: 'Tool not found: x' })).toBe('Invalid params: Tool not found: x')
    expect(describeMcpError({ message: 'Invalid params', data: { message: 'nested' } })).toBe('Invalid params: nested')
    expect(describeMcpError({ code: 1 })).toBe('')
    expect(describeMcpError('plain')).toBe('plain')
  })

  it('builds a negotiated-version notice only when the release differs', () => {
    const older = negotiatedVersionNotice({ result: { structuredContent: { ucp: { version: OLDER } } } }, 'search_catalog', 'h')
    expect(older?.key).toBe(`h|${OLDER}`)
    expect(older?.message).toContain(`older than the ${UCP_VERSION}`)
    const newer = negotiatedVersionNotice({ result: { structuredContent: { ucp: { version: NEWER } } } }, 'search_catalog', 'h')
    expect(newer?.message).toContain(UPDATE_HINT)
    expect(negotiatedVersionNotice({ result: { structuredContent: { ucp: { version: UCP_VERSION } } } }, 'x', 'h')).toBeUndefined()
    expect(negotiatedVersionNotice({ result: { structuredContent: { products: [] } } }, 'x', 'h')).toBeUndefined()
  })
})
