export type JsonObject = Record<string, unknown>

export interface HttpResponse<T = unknown> {
  status: number
  ok: boolean
  headers: Headers
  json(): Promise<T>
  text(): Promise<string>
}

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>

export interface SecretStore {
  get(account: string): Promise<string | null>
  set(account: string, value: string): Promise<void>
  delete(account: string): Promise<boolean>
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
}

// Persisted between `auth device-code` and `auth poll`. expiresAt is epoch ms.
export interface PendingDeviceAuth {
  deviceCode: string
  interval: number
  expiresAt: number
}

export interface UserInfo {
  sub?: string
  email?: string
  name?: string
  picture?: string
  [key: string]: unknown
}
