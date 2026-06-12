import {
  ACCESS_TOKEN_ACCOUNT,
  COUNTRY_ACCOUNT,
  DEVICE_ID_ACCOUNT,
  PENDING_DEVICE_AUTH_ACCOUNT,
  REFRESH_TOKEN_ACCOUNT,
  SHOP_AGENT_SERVICE,
} from './constants.js'
import type { PendingDeviceAuth, SecretStore } from './types.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type KeytarApi = Pick<typeof import('keytar'), 'getPassword' | 'setPassword' | 'deletePassword'>

export class KeytarSecretStore implements SecretStore {
  private keytarPromise: Promise<KeytarApi | null>

  constructor(private readonly service = SHOP_AGENT_SERVICE) {
    this.keytarPromise = import('keytar')
      .then((mod) => {
        const candidate = ((mod as { default?: unknown }).default ?? mod) as Partial<KeytarApi>
        const usable =
          typeof candidate.getPassword === 'function' &&
          typeof candidate.setPassword === 'function' &&
          typeof candidate.deletePassword === 'function'
        return usable ? (candidate as KeytarApi) : null
      })
      .catch(() => null)
  }

  async get(account: string): Promise<string | null> {
    const keytar = await this.keytarPromise
    if (keytar) return keytar.getPassword(this.service, account)
    return this.macGet(account)
  }

  async set(account: string, value: string): Promise<void> {
    const keytar = await this.keytarPromise
    if (keytar) {
      await keytar.setPassword(this.service, account, value)
      return
    }
    await this.macSet(account, value)
  }

  async delete(account: string): Promise<boolean> {
    const keytar = await this.keytarPromise
    if (keytar) return keytar.deletePassword(this.service, account)
    return this.macDelete(account)
  }

  private async macGet(account: string): Promise<string | null> {
    assertDarwinFallback()
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        this.service,
        '-a',
        account,
        '-w',
      ])
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  private async macSet(account: string, value: string): Promise<void> {
    assertDarwinFallback()
    const args = ['add-generic-password', '-U', '-s', this.service, '-a', account, '-w', value]
    try {
      await execFileAsync('security', args)
    } catch (error) {
      if (!isExistingKeychainItemError(error)) throw error
      await this.macDelete(account)
      await execFileAsync('security', args)
    }
  }

  private async macDelete(account: string): Promise<boolean> {
    assertDarwinFallback()
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', this.service, '-a', account])
      return true
    } catch {
      return false
    }
  }
}

function isExistingKeychainItemError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.includes('specified item already exists')
  )
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

function assertDarwinFallback(): void {
  if (process.platform !== 'darwin') {
    throw new Error(
      'OS secret storage is unavailable. Install/build keytar or run in an environment with macOS Keychain support.',
    )
  }
}
