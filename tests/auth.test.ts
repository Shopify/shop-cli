import { describe, it } from 'node:test'
import { expect, fn } from './harness.js'

import {
  ACCESS_TOKEN_ACCOUNT,
  COUNTRY_ACCOUNT,
  DEVICE_ID_ACCOUNT,
  REFRESH_TOKEN_ACCOUNT,
} from '../src/constants.js'
import { AuthClient } from '../src/auth.js'
import { createFetchMock, createStore, jsonResponse } from './test-utils.js'

describe('auth', () => {
  it('reuses a valid stored access token', async () => {
    const store = createStore({ [ACCESS_TOKEN_ACCOUNT]: 'access' })
    const fetchMock = createFetchMock((url) => {
      expect(url).toBe('https://accounts.shop.app/oauth/userinfo')
      return jsonResponse({ sub: 'user-1', email: 'buyer@example.com' })
    })

    const auth = new AuthClient({ fetch: fetchMock, store })
    await expect(auth.getValidAccessToken()).resolves.toBe('access')
  })

  it('refreshes when stored access token is invalid', async () => {
    const store = createStore({
      [ACCESS_TOKEN_ACCOUNT]: 'old-access',
      [REFRESH_TOKEN_ACCOUNT]: 'refresh',
    })
    let calls = 0
    const fetchMock = createFetchMock((url) => {
      calls += 1
      if (url.endsWith('/userinfo')) return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
      return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh' })
    })

    const auth = new AuthClient({ fetch: fetchMock, store })
    await expect(auth.getValidAccessToken()).resolves.toBe('new-access')
    await expect(store.get(ACCESS_TOKEN_ACCOUNT)).resolves.toBe('new-access')
    await expect(store.get(REFRESH_TOKEN_ACCOUNT)).resolves.toBe('new-refresh')
    expect(calls).toBe(2)
  })

  it('runs device authorization and stores tokens', async () => {
    const store = createStore()
    const events: string[] = []
    let tokenPolls = 0
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/device')) {
        return jsonResponse({
          device_code: 'device-code',
          user_code: 'ABCD',
          verification_uri_complete: 'https://shop.app/device',
          expires_in: 60,
          interval: 1,
        })
      }
      if (url.endsWith('/token')) {
        tokenPolls += 1
        if (tokenPolls === 1) return jsonResponse({ error: 'authorization_pending' })
        return jsonResponse({ access_token: 'access', refresh_token: 'refresh' })
      }
      return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
    })

    const auth = new AuthClient({
      fetch: fetchMock,
      store,
      pollSleepMs: 0,
      onDeviceCode: (message) => {
        events.push(message.userCode)
      },
    })
    await expect(auth.login()).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    expect(events).toEqual(['ABCD'])
    await expect(store.get(ACCESS_TOKEN_ACCOUNT)).resolves.toBe('access')
  })

  it('supports CLI auth status, login, and logout commands', async () => {
    const { createProgram } = await import('../src/cli.js')
    const store = createStore()
    const stdout = { write: fn() }
    const stderr = { write: fn() }
    let tokenPolls = 0
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith('/userinfo')) {
        return tokenPolls > 0
          ? jsonResponse({ sub: 'user-1', email: 'buyer@example.com' })
          : jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      if (url.endsWith('/device')) {
        return jsonResponse({
          device_code: 'device-code',
          user_code: 'ABCD',
          verification_uri_complete: 'https://shop.app/device',
          expires_in: 60,
          interval: 1,
        })
      }
      if (url.endsWith('/token')) {
        tokenPolls += 1
        return jsonResponse({ access_token: 'access', refresh_token: 'refresh' })
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const base = {
      fetch: fetchMock,
      store,
      stdout,
      stderr,
      exit: ((code: number) => {
        throw new Error(`exit ${code}`)
      }) as never,
    }

    await createProgram(base).parseAsync(['node', 'shop', 'auth', 'status'])
    expect(stdout.write).toHaveBeenLastCalledWith(expect.stringContaining('"authenticated": false'))

    await createProgram(base).parseAsync(['node', 'shop', 'auth', 'login', '--device-name', 'Openclaw'])
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('https://shop.app/device'))
    expect(stdout.write).toHaveBeenLastCalledWith(expect.stringContaining('"authenticated": true'))
    await expect(store.get(ACCESS_TOKEN_ACCOUNT)).resolves.toBe('access')

    await store.set(DEVICE_ID_ACCOUNT, 'device-1')
    await store.set(COUNTRY_ACCOUNT, 'US')
    await createProgram(base).parseAsync(['node', 'shop', 'auth', 'logout'])
    expect(stdout.write).toHaveBeenLastCalledWith(expect.stringContaining('"ok": true'))
    await expect(store.get(ACCESS_TOKEN_ACCOUNT)).resolves.toBeNull()
    await expect(store.get(REFRESH_TOKEN_ACCOUNT)).resolves.toBeNull()
    await expect(store.get(DEVICE_ID_ACCOUNT)).resolves.toBeNull()
    await expect(store.get(COUNTRY_ACCOUNT)).resolves.toBeNull()
  })
})
