import { fn } from './harness.js'

import { MemorySecretStore } from '../src/storage.js'
import type { FetchLike } from '../src/types.js'

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export function markdownResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      ...init.headers,
    },
  })
}

export function emptyResponse(init: ResponseInit = {}): Response {
  return new Response('', {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

export function createFetchMock(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchLike {
  return fn(async (url, init = {}) => handler(String(url), init)) as unknown as FetchLike
}

export async function readJsonBody(init: RequestInit): Promise<unknown> {
  if (typeof init.body !== 'string') return undefined
  return JSON.parse(init.body)
}

export function createStore(values: Record<string, string> = {}): MemorySecretStore {
  const store = new MemorySecretStore()
  for (const [key, value] of Object.entries(values)) {
    void store.set(key, value)
  }
  return store
}

export async function* stdinFrom(text: string): AsyncIterable<string> {
  yield text
}
