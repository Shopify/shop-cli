import {
  ACCESS_TOKEN_ACCOUNT,
  AUTH_SCOPES,
  CLIENT_ID,
  DEFAULT_AGENT_NAME,
  REFRESH_TOKEN_ACCOUNT,
} from './constants.js'
import { ShopCliError } from './errors.js'
import { formBody, parseJsonResponse, withUserAgent } from './http.js'
import {
  clearPendingDeviceAuth,
  loadPendingDeviceAuth,
  savePendingDeviceAuth,
  saveTokenSet,
} from './storage.js'
import type { FetchLike, SecretStore, TokenSet, UserInfo } from './types.js'

export interface AuthClientOptions {
  fetch?: FetchLike
  store: SecretStore
  clientId?: string
  deviceName?: string
  scopes?: string
  pollSleepMs?: number
  onDeviceCode?: (message: DeviceCodeMessage) => void | Promise<void>
}

export interface DeviceCodeMessage {
  verificationUriComplete: string
  userCode: string
  expiresIn: number
  interval: number
}

// Outcome of a single `auth poll` attempt. `pending` is a normal, re-runnable
// state (the user has not finished authorizing yet), not an error.
export type PollResult =
  | { status: 'authenticated'; tokens: TokenSet }
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'no_pending' }

type ExchangeOutcome =
  | { kind: 'token'; tokens: TokenSet }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }

interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  [key: string]: unknown
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri_complete: string
  interval?: number
  expires_in: number
  [key: string]: unknown
}

interface OAuthError {
  error?: string
  error_description?: string
}

export class AuthClient {
  private readonly fetchImpl: FetchLike
  private readonly clientId: string
  private readonly deviceName: string
  private readonly scopes: string
  private readonly pollSleepMs?: number

  constructor(private readonly options: AuthClientOptions) {
    this.fetchImpl = withUserAgent(options.fetch ?? fetch)
    this.clientId = options.clientId ?? CLIENT_ID
    this.deviceName = options.deviceName ?? DEFAULT_AGENT_NAME
    this.scopes = options.scopes ?? AUTH_SCOPES
    this.pollSleepMs = options.pollSleepMs
  }

  async getValidAccessToken(): Promise<string | null> {
    const accessToken = await this.options.store.get(ACCESS_TOKEN_ACCOUNT)
    if (accessToken) {
      const valid = await this.validate(accessToken).catch(() => null)
      if (valid) return accessToken
    }

    const refreshToken = await this.options.store.get(REFRESH_TOKEN_ACCOUNT)
    if (!refreshToken) return null

    const refreshed = await this.refresh(refreshToken).catch(() => null)
    if (!refreshed) return null
    await saveTokenSet(this.options.store, refreshed)
    return refreshed.accessToken
  }

  async refreshStoredToken(): Promise<TokenSet | null> {
    const refreshToken = await this.options.store.get(REFRESH_TOKEN_ACCOUNT)
    if (!refreshToken) return null
    const refreshed = await this.refresh(refreshToken).catch(() => null)
    if (!refreshed) return null
    await saveTokenSet(this.options.store, refreshed)
    return refreshed
  }

  // Blocking single-call login (device code + poll-to-completion). Suitable for
  // an interactive human terminal. Agents should prefer the two-step
  // startDeviceAuthorization() + completeDeviceAuthorization() flow, which does
  // not require keeping a long-lived polling process alive between turns.
  async login(): Promise<TokenSet> {
    const existing = await this.getValidAccessToken()
    if (existing) return { accessToken: existing }

    const device = await this.requestDeviceCode()
    await this.persistAndNotify(device)

    const tokens = await this.pollForToken(device)
    await saveTokenSet(this.options.store, tokens)
    await clearPendingDeviceAuth(this.options.store)
    return tokens
  }

  // Phase 1: request a device code, persist it, and surface the sign-in URL.
  // Returns immediately so the agent can show the link and hand control back to
  // the user. Tokens are NOT stored yet — call completeDeviceAuthorization()
  // after the user finishes authorizing.
  async startDeviceAuthorization(): Promise<DeviceCodeMessage> {
    const device = await this.requestDeviceCode()
    return this.persistAndNotify(device)
  }

  // Phase 2: read the pending device code and attempt one token exchange. Safe
  // to re-run while the result is `pending`. Stores tokens on success and clears
  // the pending state on any terminal outcome.
  async completeDeviceAuthorization(): Promise<PollResult> {
    const pending = await loadPendingDeviceAuth(this.options.store)
    if (!pending) return { status: 'no_pending' }
    if (Date.now() >= pending.expiresAt) {
      await clearPendingDeviceAuth(this.options.store)
      return { status: 'expired' }
    }

    const outcome = await this.exchangeDeviceCode(pending.deviceCode)
    switch (outcome.kind) {
      case 'token':
        await saveTokenSet(this.options.store, outcome.tokens)
        await clearPendingDeviceAuth(this.options.store)
        return { status: 'authenticated', tokens: outcome.tokens }
      case 'pending':
      case 'slow_down':
        return { status: 'pending' }
      case 'expired':
        await clearPendingDeviceAuth(this.options.store)
        return { status: 'expired' }
      case 'denied':
        await clearPendingDeviceAuth(this.options.store)
        return { status: 'denied' }
      default:
        throw new ShopCliError(outcome.message)
    }
  }

  async validate(accessToken: string): Promise<UserInfo> {
    const response = await this.fetchImpl('https://accounts.shop.app/oauth/userinfo', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })
    return parseJsonResponse<UserInfo>(response, 'Validate access token')
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const response = await this.fetchImpl('https://accounts.shop.app/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
      }),
    })
    const json = await parseJsonResponse<OAuthTokenResponse>(response, 'Refresh access token')
    return normalizeTokenResponse(json)
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await this.fetchImpl('https://accounts.shop.app/oauth/device', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        client_id: this.clientId,
        scope: this.scopes,
        device_name: this.deviceName.slice(0, 40),
      }),
    })
    return parseJsonResponse<DeviceCodeResponse>(response, 'Request device code')
  }

  private async persistAndNotify(device: DeviceCodeResponse): Promise<DeviceCodeMessage> {
    const interval = device.interval ?? 5
    await savePendingDeviceAuth(this.options.store, {
      deviceCode: device.device_code,
      interval,
      expiresAt: Date.now() + device.expires_in * 1000,
    })
    const message: DeviceCodeMessage = {
      verificationUriComplete: device.verification_uri_complete,
      userCode: device.user_code,
      expiresIn: device.expires_in,
      interval,
    }
    await this.options.onDeviceCode?.(message)
    return message
  }

  // One token-endpoint exchange attempt, classified into a discriminated result.
  // Shared by the blocking poll loop and the single-shot completeDeviceAuthorization().
  private async exchangeDeviceCode(deviceCode: string): Promise<ExchangeOutcome> {
    const response = await this.fetchImpl('https://accounts.shop.app/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.clientId,
      }),
    })
    const json = (await response.json()) as OAuthTokenResponse & OAuthError

    if (response.ok && json.access_token) return { kind: 'token', tokens: normalizeTokenResponse(json) }

    switch (json.error) {
      case 'authorization_pending':
        return { kind: 'pending' }
      case 'slow_down':
        return { kind: 'slow_down' }
      case 'expired_token':
        return { kind: 'expired' }
      case 'access_denied':
        return { kind: 'denied' }
      default:
        return { kind: 'error', message: json.error_description ?? json.error ?? 'Device authorization failed' }
    }
  }

  private async pollForToken(device: DeviceCodeResponse): Promise<TokenSet> {
    let intervalMs = (device.interval ?? 5) * 1000
    const expiresAt = Date.now() + device.expires_in * 1000

    while (Date.now() < expiresAt) {
      await sleep(this.pollSleepMs ?? intervalMs)
      const outcome = await this.exchangeDeviceCode(device.device_code)
      switch (outcome.kind) {
        case 'token':
          return outcome.tokens
        case 'pending':
          continue
        case 'slow_down':
          intervalMs += 5000
          continue
        case 'expired':
          throw new ShopCliError('Device code expired')
        case 'denied':
          throw new ShopCliError('Device authorization denied')
        default:
          throw new ShopCliError(outcome.message)
      }
    }

    throw new ShopCliError('Device authorization expired')
  }
}

function normalizeTokenResponse(json: OAuthTokenResponse): TokenSet {
  const { access_token, refresh_token } = json
  if (!access_token) throw new ShopCliError('OAuth response did not include access_token')
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
