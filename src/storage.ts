import {
  ACCESS_TOKEN_ACCOUNT,
  COUNTRY_ACCOUNT,
  DEVICE_ID_ACCOUNT,
  PENDING_DEVICE_AUTH_ACCOUNT,
  REFRESH_TOKEN_ACCOUNT,
  SHOP_AGENT_SERVICE,
} from './constants.js'
import type { PendingDeviceAuth, SecretStore } from './types.js'
import { execFile, spawn, type ExecFileException } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type SecretBackend = 'keychain' | 'secret-tool' | 'file'

// Zero-native-dependency secret store. Resolution order:
//   1. SHOP_CLI_SECRET_BACKEND env override (keychain | secret-tool | file)
//   2. macOS Keychain via the `security` CLI (always present on darwin)
//   3. libsecret via the `secret-tool` CLI (Linux desktops with a secret service)
//   4. JSON file at SHOP_CLI_SECRETS_PATH or ~/.shop-cli/secrets.json (0600),
//      with a one-time stderr notice when reached implicitly
export class PortableSecretStore implements SecretStore {
  private backendPromise: Promise<SecretBackend> | undefined
  private warned = false
  private fileQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly service = SHOP_AGENT_SERVICE,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async get(account: string): Promise<string | null> {
    switch (await this.backend()) {
      case 'keychain':
        return this.macGet(account)
      case 'secret-tool':
        return this.linuxGet(account)
      case 'file':
        return this.fileGet(account)
    }
  }

  async set(account: string, value: string): Promise<void> {
    switch (await this.backend()) {
      case 'keychain':
        return this.macSet(account, value)
      case 'secret-tool':
        return this.linuxSet(account, value)
      case 'file':
        return this.fileSet(account, value)
    }
  }

  async delete(account: string): Promise<boolean> {
    switch (await this.backend()) {
      case 'keychain':
        return this.macDelete(account)
      case 'secret-tool':
        return this.linuxDelete(account)
      case 'file':
        return this.fileDelete(account)
    }
  }

  private backend(): Promise<SecretBackend> {
    this.backendPromise ??= this.resolveBackend()
    return this.backendPromise
  }

  private async resolveBackend(): Promise<SecretBackend> {
    const override = this.env.SHOP_CLI_SECRET_BACKEND?.toLowerCase()
    if (override === 'keychain' || override === 'secret-tool' || override === 'file') {
      return override
    }
    if (override) {
      process.stderr.write(
        `shop-cli: unknown SHOP_CLI_SECRET_BACKEND "${override}" (expected keychain | secret-tool | file); auto-detecting instead.\n`,
      )
    }
    if (this.platform === 'darwin') return 'keychain'
    if (await this.hasSecretTool()) return 'secret-tool'
    this.warnFileFallback()
    return 'file'
  }

  private hasSecretTool(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        'secret-tool',
        ['lookup', 'service', this.service, 'account', '__probe__'],
        { timeout: 5_000 },
        (error, _stdout, stderr) => {
          resolve(isSecretServiceAvailable(error, stderr))
        },
      )
    })
  }

  private warnFileFallback(): void {
    if (this.warned) return
    this.warned = true
    process.stderr.write(
      `shop-cli: no OS keychain available; storing secrets in ${this.filePath()} (mode 0600). Set SHOP_CLI_SECRET_BACKEND=file to acknowledge and silence this notice.\n`,
    )
  }

  // --- macOS Keychain via `security` ---

  private async macGet(account: string): Promise<string | null> {
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
    try {
      await execFileAsync('security', ['delete-generic-password', '-s', this.service, '-a', account])
      return true
    } catch {
      return false
    }
  }

  // --- Linux secret service via `secret-tool` ---

  private async linuxGet(account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('secret-tool', [
        'lookup',
        'service',
        this.service,
        'account',
        account,
      ])
      return stdout.replace(/\n$/, '') || null
    } catch {
      return null
    }
  }

  private async linuxSet(account: string, value: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('secret-tool', [
        'store',
        `--label=${this.service} ${account}`,
        'service',
        this.service,
        'account',
        account,
      ])
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`secret-tool store failed (exit ${code}): ${stderr.trim()}`))
      })
      child.stdin.end(value)
    })
  }

  private async linuxDelete(account: string): Promise<boolean> {
    try {
      await execFileAsync('secret-tool', ['clear', 'service', this.service, 'account', account])
      return true
    } catch {
      return false
    }
  }

  // --- File fallback ---

  private filePath(): string {
    return this.env.SHOP_CLI_SECRETS_PATH ?? join(homedir(), '.shop-cli', 'secrets.json')
  }

  private async readFileStore(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.filePath(), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>
      }
      return {}
    } catch {
      return {}
    }
  }

  private async writeFileStore(values: Record<string, string>): Promise<void> {
    const path = this.filePath()
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tmp, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, path)
    await chmod(path, 0o600)
  }

  private withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.fileQueue.then(operation, operation)
    this.fileQueue = run.catch(() => undefined)
    return run
  }

  private fileGet(account: string): Promise<string | null> {
    return this.withFileLock(async () => {
      const values = await this.readFileStore()
      return values[account] ?? null
    })
  }

  private fileSet(account: string, value: string): Promise<void> {
    return this.withFileLock(async () => {
      const values = await this.readFileStore()
      values[account] = value
      await this.writeFileStore(values)
    })
  }

  private fileDelete(account: string): Promise<boolean> {
    return this.withFileLock(async () => {
      const values = await this.readFileStore()
      if (!(account in values)) return false
      delete values[account]
      await this.writeFileStore(values)
      return true
    })
  }
}

function isSecretServiceAvailable(error: ExecFileException | null, stderr: string): boolean {
  return error === null || (error.code === 1 && stderr.trim() === '')
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
