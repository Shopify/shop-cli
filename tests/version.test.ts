import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { createProgram } from '../src/cli.js'
import { USER_AGENT } from '../src/constants.js'
import { expect } from './harness.js'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version?: unknown }

describe('version metadata', () => {
  it('the package version looks like a real semver, not a missing/blank field', () => {
    expect(typeof packageJson.version).toBe('string')
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('uses the package version for the CLI', () => {
    expect(createProgram().version()).toBe(packageJson.version)
  })

  it('uses the package version for the User-Agent', () => {
    expect(USER_AGENT).toBe(`shop-cli/${packageJson.version}`)
  })
})
