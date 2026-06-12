import { USER_AGENT } from './constants.js'
import { ShopCliError } from './errors.js'
import type { FetchLike } from './types.js'

export function withUserAgent(fetchImpl: FetchLike): FetchLike {
  return (url, init = {}) => {
    const headers = { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) }
    return fetchImpl(url, { ...init, headers })
  }
}

export async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text()
  const body = text.length > 0 ? safeJsonParse(text) : undefined

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `${label} failed`
    throw new ShopCliError(message, {
      status: response.status,
      code: extractErrorCode(body),
      details: body ?? text,
    })
  }

  if (body === undefined) {
    throw new ShopCliError(`${label} returned an empty response`, { status: response.status })
  }

  return body as T
}

export async function parseOptionalJsonResponse<T>(response: Response, label: string, fallback: T): Promise<T> {
  const text = await response.text()
  const body = text.length > 0 ? safeJsonParse(text) : undefined

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `${label} failed`
    throw new ShopCliError(message, {
      status: response.status,
      code: extractErrorCode(body),
      details: body ?? text,
    })
  }

  if (body === undefined) return fallback
  return body as T
}

export async function parseTextResponse(
  response: Response,
  label: string,
  fallback = '',
): Promise<string> {
  const text = await response.text()

  if (!response.ok) {
    // This endpoint reports failures as markdown (e.g. `# Error\n\n{message} ({status})`),
    // so surface the body text directly rather than trying to parse JSON out of it.
    const message = text.trim().length > 0 ? text.trim() : `${label} failed`
    throw new ShopCliError(message, { status: response.status })
  }

  return text.trim().length > 0 ? text : fallback
}

export function formBody(values: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) params.set(key, value)
  return params
}

export function jsonHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...headers,
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  if (typeof record.error_description === 'string') return record.error_description
  if (typeof record.message === 'string') return record.message
  if (typeof record.error === 'string') return record.error
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
  }
  return undefined
}

function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  if (typeof record.error === 'string') return record.error
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.code === 'string') return nested.code
    if (typeof nested.code === 'number') return String(nested.code)
  }
  return undefined
}
