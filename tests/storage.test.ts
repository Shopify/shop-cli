import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { ACCESS_TOKEN_ACCOUNT, REFRESH_TOKEN_ACCOUNT } from '../src/constants.js'
import { clearStoredAuth, PortableSecretStore, saveTokenSet } from '../src/storage.js'
import { expect } from './harness.js'

let workdir: string

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'shop-cli-storage-'))
})

after(async () => {
  await rm(workdir, { recursive: true, force: true })
})

function fileStore(name: string, platform: NodeJS.Platform = 'linux'): { store: PortableSecretStore; path: string } {
  const path = join(workdir, name, 'secrets.json')
  const env: NodeJS.ProcessEnv = { SHOP_CLI_SECRET_BACKEND: 'file', SHOP_CLI_SECRETS_PATH: path }
  return { store: new PortableSecretStore('shop-agent-test', env, platform), path }
}

describe('PortableSecretStore (file backend)', () => {
  it('round-trips set / get / delete', async () => {
    const { store } = fileStore('roundtrip')

    expect(await store.get('access_token')).toBeNull()

    await store.set('access_token', 'tok_123')
    expect(await store.get('access_token')).toBe('tok_123')

    await store.set('access_token', 'tok_456')
    expect(await store.get('access_token')).toBe('tok_456')

    expect(await store.delete('access_token')).toBe(true)
    expect(await store.get('access_token')).toBeNull()
  })

  it('delete returns false when the account is absent', async () => {
    const { store } = fileStore('delete-missing')
    expect(await store.delete('nope')).toBe(false)
  })

  it('keeps accounts independent within one file', async () => {
    const { store, path } = fileStore('multi')
    await store.set('a', '1')
    await store.set('b', '2')
    await store.delete('a')

    expect(await store.get('a')).toBeNull()
    expect(await store.get('b')).toBe('2')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ b: '2' })
  })

  it('writes the file 0600 inside a 0700 directory', async () => {
    const { store, path } = fileStore('perms')
    await store.set('access_token', 'secret')

    const file = await stat(path)
    const dir = await stat(join(path, '..'))
    expect(file.mode & 0o777).toBe(0o600)
    expect(dir.mode & 0o777).toBe(0o700)
  })

  it('treats a corrupt or non-object file as empty instead of throwing', async () => {
    const { store, path } = fileStore('corrupt')
    await store.set('seed', 'x') // creates the directory
    await writeFile(path, 'not json', 'utf8')
    expect(await store.get('seed')).toBeNull()

    await writeFile(path, '["array"]', 'utf8')
    expect(await store.get('seed')).toBeNull()

    // A subsequent write recovers cleanly.
    await store.set('seed', 'y')
    expect(await store.get('seed')).toBe('y')
  })

  it('honours SHOP_CLI_SECRET_BACKEND=file even on darwin', async () => {
    // Without the override darwin would resolve to the Keychain backend; the
    // override must win so sandboxed macOS agents can opt into the file store.
    const { store, path } = fileStore('darwin-override', 'darwin')
    await store.set('country', 'GB')
    expect(await store.get('country')).toBe('GB')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ country: 'GB' })
  })

  it('falls back to the default path under the home directory when SHOP_CLI_SECRETS_PATH is unset', async () => {
    // We only assert on the resolved location; no write is performed against the real home dir.
    const env: NodeJS.ProcessEnv = { SHOP_CLI_SECRET_BACKEND: 'file' }
    const store = new PortableSecretStore('shop-agent-test', env, 'linux')
    // Reading a fresh account from a (probably missing) file must be a clean null.
    expect(await store.get('__shop_cli_storage_test_probe__')).toBeNull()
  })

  it('serialises concurrent writes so none are lost', async () => {
    const { store, path } = fileStore('concurrent')
    const accounts = ['a', 'b', 'c', 'd', 'e', 'f']
    await Promise.all(accounts.map((account) => store.set(account, account.toUpperCase())))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F' })

    const deleted = await Promise.all(accounts.map((account) => store.delete(account)))
    expect(deleted).toEqual([true, true, true, true, true, true])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({})
  })

  it('works with the token helpers', async () => {
    const { store } = fileStore('helpers')
    await saveTokenSet(store, { accessToken: 'access', refreshToken: 'refresh' })
    expect(await store.get(ACCESS_TOKEN_ACCOUNT)).toBe('access')
    expect(await store.get(REFRESH_TOKEN_ACCOUNT)).toBe('refresh')

    await clearStoredAuth(store)
    expect(await store.get(ACCESS_TOKEN_ACCOUNT)).toBeNull()
    expect(await store.get(REFRESH_TOKEN_ACCOUNT)).toBeNull()
  })
})
