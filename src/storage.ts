import {
  ACCESS_TOKEN_ACCOUNT,
  COUNTRY_ACCOUNT,
  DEVICE_ID_ACCOUNT,
  PENDING_DEVICE_AUTH_ACCOUNT,
  REFRESH_TOKEN_ACCOUNT,
  SHOP_AGENT_SERVICE,
} from './constants.js'
import type { PendingDeviceAuth, SecretStore } from './types.js'

interface KeyringEntry {
  getPassword(): string | null
  setPassword(value: string): void
  deletePassword(): boolean
}
interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry
}

export class OsKeyringSecretStore implements SecretStore {
  private modulePromise?: Promise<KeyringModule>

  constructor(private readonly service = SHOP_AGENT_SERVICE) {}

  async get(account: string): Promise<string | null> {
    const entry = await this.entry(account)
    try {
      return entry.getPassword()
    } catch (error) {
      throw secretStoreError('read', error)
    }
  }

  async set(account: string, value: string): Promise<void> {
    const entry = await this.entry(account)
    try {
      entry.setPassword(value)
    } catch (error) {
      throw secretStoreError('write', error)
    }
  }

  async delete(account: string): Promise<boolean> {
    const entry = await this.entry(account)
    try {
      return entry.deletePassword()
    } catch (error) {
      throw secretStoreError('delete', error)
    }
  }

  private async entry(account: string): Promise<KeyringEntry> {
    this.modulePromise ??= import('@napi-rs/keyring') as Promise<KeyringModule>
    let keyring: KeyringModule
    try {
      keyring = await this.modulePromise
    } catch (error) {
      this.modulePromise = undefined
      throw secretStoreError('load', error)
    }
    return new keyring.Entry(this.service, account)
  }
}

export class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>()

  async get(account: string): Promise<string | null> {
    return this.values.get(account) ?? null
  }

  async set(account: string, value: string): Promise<void> {
    this.values.set(account, value)
  }

  async delete(account: string): Promise<boolean> {
    return this.values.delete(account)
  }
}

export async function saveTokenSet(
  store: SecretStore,
  tokens: { accessToken: string; refreshToken?: string },
): Promise<void> {
  await store.set(ACCESS_TOKEN_ACCOUNT, tokens.accessToken)
  if (tokens.refreshToken) await store.set(REFRESH_TOKEN_ACCOUNT, tokens.refreshToken)
}

export async function clearStoredAuth(store: SecretStore): Promise<void> {
  await Promise.all([
    store.delete(ACCESS_TOKEN_ACCOUNT),
    store.delete(REFRESH_TOKEN_ACCOUNT),
    store.delete(DEVICE_ID_ACCOUNT),
    store.delete(COUNTRY_ACCOUNT),
    store.delete(PENDING_DEVICE_AUTH_ACCOUNT),
  ])
}

// Device-authorization is a two-step flow: `auth device-code` emits the sign-in
// URL and stashes the device_code here; `auth poll` reads it back to exchange
// for tokens. Persisting it (rather than holding it in a long-lived polling
// process) is what lets the agent return control to the user between turns.
export async function savePendingDeviceAuth(
  store: SecretStore,
  pending: PendingDeviceAuth,
): Promise<void> {
  await store.set(PENDING_DEVICE_AUTH_ACCOUNT, JSON.stringify(pending))
}

export async function loadPendingDeviceAuth(store: SecretStore): Promise<PendingDeviceAuth | null> {
  const raw = await store.get(PENDING_DEVICE_AUTH_ACCOUNT)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PendingDeviceAuth
    if (!parsed?.deviceCode) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearPendingDeviceAuth(store: SecretStore): Promise<void> {
  await store.delete(PENDING_DEVICE_AUTH_ACCOUNT)
}

export async function getOrCreateDeviceId(
  store: SecretStore,
  randomUUID: () => string = crypto.randomUUID.bind(crypto),
): Promise<string> {
  const existing = await store.get(DEVICE_ID_ACCOUNT)
  if (existing) return existing
  const deviceId = randomUUID()
  await store.set(DEVICE_ID_ACCOUNT, deviceId)
  return deviceId
}

export async function getCountry(store: SecretStore, fallback: string): Promise<string> {
  return (await store.get(COUNTRY_ACCOUNT)) ?? fallback
}

export async function setCountry(store: SecretStore, country: string): Promise<void> {
  await store.set(COUNTRY_ACCOUNT, country.toUpperCase())
}

function secretStoreError(op: 'load' | 'read' | 'write' | 'delete', cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  const action = op === 'load' ? 'access' : op
  return new Error(
    `Could not ${action} the OS secret store. Shop credentials are kept in your OS keychain ` +
      '(macOS Keychain, Windows Credential Manager, or Linux Secret Service); ensure one is ' +
      `available and unlocked, then retry. (${detail})`,
  )
}
