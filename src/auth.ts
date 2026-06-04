import {
  ACCESS_TOKEN_ACCOUNT,
  AUTH_SCOPES,
  CLIENT_ID,
  DEFAULT_AGENT_NAME,
  REFRESH_TOKEN_ACCOUNT,
} from './constants.js'
import { ShopCliError } from './errors.js'
import { formBody, parseJsonResponse } from './http.js'
import { saveTokenSet } from './storage.js'
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
    this.fetchImpl = options.fetch ?? fetch
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

  async login(): Promise<TokenSet> {
    const existing = await this.getValidAccessToken()
    if (existing) return { accessToken: existing }

    const device = await this.requestDeviceCode()
    await this.options.onDeviceCode?.({
      verificationUriComplete: device.verification_uri_complete,
      userCode: device.user_code,
      expiresIn: device.expires_in,
      interval: device.interval ?? 5,
    })

    const tokens = await this.pollForToken(device)
    await saveTokenSet(this.options.store, tokens)
    return tokens
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

  private async pollForToken(device: DeviceCodeResponse): Promise<TokenSet> {
    let intervalMs = (device.interval ?? 5) * 1000
    const expiresAt = Date.now() + device.expires_in * 1000

    while (Date.now() < expiresAt) {
      await sleep(this.pollSleepMs ?? intervalMs)
      const response = await this.fetchImpl('https://accounts.shop.app/oauth/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
          client_id: this.clientId,
        }),
      })
      const json = (await response.json()) as OAuthTokenResponse & OAuthError

      if (response.ok && json.access_token) return normalizeTokenResponse(json)

      if (json.error === 'authorization_pending') continue
      if (json.error === 'slow_down') {
        intervalMs += 5000
        continue
      }
      if (json.error === 'expired_token') throw new ShopCliError('Device code expired')
      if (json.error === 'access_denied') throw new ShopCliError('Device authorization denied')
      throw new ShopCliError(json.error_description ?? json.error ?? 'Device authorization failed')
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
