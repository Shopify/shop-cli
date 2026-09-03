import { UCP_VERSION } from './constants.js'
import type { FetchLike, JsonObject } from './types.js'

// UCP servers negotiate DOWN to the release named in the agent profile, so a
// successful response never reveals that this CLI is behind. The only
// server-published signal is the discovery manifest at /.well-known/ucp, which
// lists the server's default `version` and the older `supported_versions` it
// still accepts. Everything here compares the pinned UCP_VERSION against that.

export type UcpVersionStatus = 'current' | 'outdated' | 'unsupported' | 'ahead' | 'unknown'

export interface UcpVersionCheck {
  host: string
  manifest_url: string
  cli_ucp_version: string
  server_version: string | null
  supported_versions: string[]
  status: UcpVersionStatus
  message: string
}

export interface UcpManifestVersions {
  version: string
  supported: string[]
}

export const UPDATE_HINT =
  'Update shop-cli: `npm install --global @shopify/shop-cli@latest` (or `pnpm add --global @shopify/shop-cli@latest`).'

export function manifestUrlFor(host: string): string {
  const trimmed = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  return `https://${trimmed}/.well-known/ucp`
}

// Read `ucp.version` and `ucp.supported_versions` from a host's discovery
// manifest. Never throws: any network, HTTP, or shape problem yields null so
// callers can degrade to "unknown" instead of failing the command.
export async function fetchUcpManifestVersions(
  fetchImpl: FetchLike,
  host: string,
): Promise<UcpManifestVersions | null> {
  try {
    const response = await fetchImpl(manifestUrlFor(host), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = JSON.parse(await response.text()) as unknown
    return parseManifestVersions(body)
  } catch {
    return null
  }
}

export function parseManifestVersions(body: unknown): UcpManifestVersions | null {
  const root = isRecord(body) ? body : null
  const ucp = root && isRecord(root.ucp) ? root.ucp : root
  if (!ucp || typeof ucp.version !== 'string') return null
  const supported = new Set<string>([ucp.version])
  const declared = ucp.supported_versions
  if (Array.isArray(declared)) {
    for (const entry of declared) if (typeof entry === 'string') supported.add(entry)
  } else if (isRecord(declared)) {
    for (const key of Object.keys(declared)) supported.add(key)
  }
  return { version: ucp.version, supported: sortVersionsDesc([...supported]) }
}

export function classifyUcpVersion(
  manifest: UcpManifestVersions | null,
  host: string,
  cliVersion = UCP_VERSION,
): UcpVersionCheck {
  const base = {
    host,
    manifest_url: manifestUrlFor(host),
    cli_ucp_version: cliVersion,
  }

  if (!manifest) {
    return {
      ...base,
      server_version: null,
      supported_versions: [],
      status: 'unknown',
      message: `Could not read the UCP manifest at ${base.manifest_url}, so the version could not be checked. shop-cli speaks UCP ${cliVersion}.`,
    }
  }

  const supported = manifest.supported
  const list = supported.join(', ')
  const cliSupported = supported.includes(cliVersion)
  const withVersions = { ...base, server_version: manifest.version, supported_versions: supported }

  if (manifest.version === cliVersion) {
    return {
      ...withVersions,
      status: 'current',
      message: `shop-cli speaks UCP ${cliVersion}, the current release at ${host}.`,
    }
  }

  if (manifest.version > cliVersion) {
    if (cliSupported) {
      return {
        ...withVersions,
        status: 'outdated',
        message: `${host} is on UCP ${manifest.version}; shop-cli speaks ${cliVersion}, which ${host} still supports (${list}) but will drop in a future release. ${UPDATE_HINT}`,
      }
    }
    return {
      ...withVersions,
      status: 'unsupported',
      message: `${host} no longer supports UCP ${cliVersion}, the release this shop-cli speaks (it accepts ${list}). Calls will fail until you update. ${UPDATE_HINT}`,
    }
  }

  // Server default is older than the CLI.
  if (cliSupported) {
    return {
      ...withVersions,
      status: 'current',
      message: `${host} supports UCP ${cliVersion}, the release shop-cli speaks (its default is ${manifest.version}).`,
    }
  }
  return {
    ...withVersions,
    status: 'ahead',
    message: `${host} has not adopted UCP ${cliVersion} yet (it supports ${list}). shop-cli is newer than this server, so requests may be negotiated down or fail; updating shop-cli will not help.`,
  }
}

export async function checkUcpVersion(fetchImpl: FetchLike, host: string): Promise<UcpVersionCheck> {
  return classifyUcpVersion(await fetchUcpManifestVersions(fetchImpl, host), host)
}

// A successful MCP result carries the negotiated release in
// `result.structuredContent.ucp.version`. Returns a notice when it differs from
// the release the CLI asked for, plus a dedupe key so callers can report each
// host/version pair once per process.
export function negotiatedVersionNotice(
  payload: unknown,
  toolName: string,
  host: string,
  cliVersion = UCP_VERSION,
): { key: string; message: string } | undefined {
  const version = negotiatedVersionOf(payload)
  if (!version || version === cliVersion) return undefined
  const key = `${host}|${version}`
  if (version < cliVersion) {
    return {
      key,
      message: `${host} answered ${toolName} with UCP ${version}, older than the ${cliVersion} shop-cli requested. This server has not adopted ${cliVersion} yet, so its responses follow the ${version} schema.`,
    }
  }
  return {
    key,
    message: `${host} answered ${toolName} with UCP ${version}, newer than the ${cliVersion} shop-cli speaks. ${UPDATE_HINT}`,
  }
}

export function negotiatedVersionOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const result = isRecord(payload.result) ? payload.result : payload
  const content = isRecord(result.structuredContent) ? result.structuredContent : result
  const ucp = isRecord(content.ucp) ? content.ucp : undefined
  return typeof ucp?.version === 'string' ? ucp.version : undefined
}

// JSON-RPC error envelopes carry the useful part in `message` and often a
// human-readable `data` string ("Tool not found: search_catalog"). Join them so
// the CLI error shows what the server actually said.
export function describeMcpError(error: unknown): string {
  if (typeof error === 'string') return error
  if (!isRecord(error)) return ''
  const parts: string[] = []
  if (typeof error.message === 'string' && error.message.length > 0) parts.push(error.message)
  const data = error.data
  if (typeof data === 'string' && data.length > 0) parts.push(data)
  else if (isRecord(data) && typeof data.message === 'string') parts.push(data.message)
  return parts.join(': ')
}

// The failure a stale CLI hits: the server dropped the release named in the
// agent profile, so the tool the CLI is built against is "not found".
export function isUnknownToolError(error: unknown): boolean {
  if (!isRecord(error)) return false
  if (error.code === -32601) return true
  return /tool not found|unknown tool|no such tool/i.test(describeMcpError(error))
}

export function unknownToolGuidance(check: UcpVersionCheck): string {
  switch (check.status) {
    case 'unsupported':
    case 'outdated':
    case 'ahead':
      return check.message
    case 'current':
      return `${check.host} still supports UCP ${check.cli_ucp_version}, so this is not a version mismatch.`
    case 'unknown':
      return `This usually means ${check.host} no longer accepts UCP ${check.cli_ucp_version}, the release this shop-cli speaks. ${UPDATE_HINT}`
  }
}

function sortVersionsDesc(versions: string[]): string[] {
  // UCP releases are YYYY-MM-DD strings, so lexical order is chronological.
  return [...versions].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
