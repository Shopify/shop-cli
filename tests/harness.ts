/**
 * Minimal vitest-compatible test harness backed by node:test + node:assert.
 *
 * Implements only the surface this suite uses: describe/it/test, an expect()
 * with the matchers below, .not/.resolves/.rejects modifiers, expect.stringContaining,
 * and a fn() mock wrapper around node:test's mock.fn().
 */
import assert from 'node:assert/strict'
import { mock } from 'node:test'

export { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'

/** Mock function wrapper. Returns a node:test mock.fn so .mock.calls is available. */
export function fn<T extends (...args: any[]) => any>(impl?: T) {
  return mock.fn(impl as any)
}

type Asym = { $$asym: string; test: (actual: unknown) => boolean; toString(): string }
function isAsym(value: unknown): value is Asym {
  return !!value && typeof value === 'object' && typeof (value as any).$$asym === 'string'
}

function fmt(value: unknown): string {
  if (isAsym(value)) return value.toString()
  if (typeof value === 'function') return '[Function]'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Recursive structural match. partial=true allows extra keys (toMatchObject). */
function deepMatch(actual: unknown, expected: unknown, partial: boolean): boolean {
  if (isAsym(expected)) return expected.test(actual)
  if (expected && typeof expected === 'object') {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return false
      if (!partial && actual.length !== expected.length) return false
      return expected.every((item, i) => deepMatch((actual as unknown[])[i], item, partial))
    }
    if (!actual || typeof actual !== 'object') return false
    if (!partial) {
      const actualKeys = Object.keys(actual as object)
      const expectedKeys = Object.keys(expected as object)
      if (actualKeys.length !== expectedKeys.length) return false
    }
    return Object.keys(expected as object).every((key) =>
      deepMatch((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], partial),
    )
  }
  return Object.is(actual, expected)
}

function callsOf(value: any): unknown[][] {
  const calls = value?.mock?.calls ?? []
  return calls.map((call: any) => (Array.isArray(call) ? call : call?.arguments ?? []))
}

type AwaitMode = 'none' | 'resolve' | 'reject'

function buildMatchers(getActual: () => unknown, negate: boolean, awaitMode: AwaitMode) {
  const check = (pass: boolean, message: string) =>
    assert.ok(negate ? !pass : pass, `${negate ? 'NOT ' : ''}${message}`)

  // Resolve the "actual" value according to await mode, then run the matcher logic.
  const apply = (logic: (actual: unknown) => void): void | Promise<void> => {
    if (awaitMode === 'none') return logic(getActual())
    if (awaitMode === 'resolve') return Promise.resolve(getActual() as Promise<unknown>).then(logic)
    // reject: expect the promise to throw; pass the error to the matcher.
    return Promise.resolve(getActual() as Promise<unknown>).then(
      () => {
        throw new assert.AssertionError({ message: 'expected promise to reject, but it resolved' })
      },
      (error) => logic(error),
    )
  }

  const assertThrow = (error: unknown, arg?: string | RegExp | (new (...a: any[]) => Error)) => {
    const message = error instanceof Error ? error.message : String(error)
    let pass = error !== undefined
    if (arg instanceof RegExp) pass = arg.test(message)
    else if (typeof arg === 'string') pass = message.includes(arg)
    check(pass, `error ${fmt(message)} to match ${fmt(arg)}`)
  }

  return {
    toBe: (expected: unknown) => apply((a) => check(Object.is(a, expected), `${fmt(a)} to be ${fmt(expected)}`)),
    toEqual: (expected: unknown) =>
      apply((a) => check(deepMatch(a, expected, false), `${fmt(a)} to equal ${fmt(expected)}`)),
    toStrictEqual: (expected: unknown) =>
      apply((a) => check(deepMatch(a, expected, false), `${fmt(a)} to strictly equal ${fmt(expected)}`)),
    toMatchObject: (expected: unknown) =>
      apply((a) => check(deepMatch(a, expected, true), `${fmt(a)} to match object ${fmt(expected)}`)),
    toContain: (item: unknown) =>
      apply((a) => {
        const pass =
          typeof a === 'string'
            ? a.includes(String(item))
            : Array.isArray(a)
              ? a.some((x) => Object.is(x, item) || deepMatch(x, item, false))
              : false
        check(pass, `${fmt(a)} to contain ${fmt(item)}`)
      }),
    toMatch: (expected: string | RegExp) =>
      apply((a) => {
        const str = String(a)
        const pass = expected instanceof RegExp ? expected.test(str) : str.includes(expected)
        check(pass, `${fmt(a)} to match ${fmt(expected)}`)
      }),
    toHaveLength: (length: number) =>
      apply((a) => check((a as { length?: number })?.length === length, `${fmt(a)} to have length ${length}`)),
    toHaveProperty: (key: string) =>
      apply((a) =>
        check(
          a != null && Object.prototype.hasOwnProperty.call(a, key),
          `${fmt(a)} to have property ${fmt(key)}`,
        ),
      ),
    toBeNull: () => apply((a) => check(a === null, `${fmt(a)} to be null`)),
    toBeUndefined: () => apply((a) => check(a === undefined, `${fmt(a)} to be undefined`)),
    toBeDefined: () => apply((a) => check(a !== undefined, `${fmt(a)} to be defined`)),
    toThrow: (arg?: string | RegExp) => {
      if (awaitMode !== 'none') return apply((error) => assertThrow(error, arg))
      let error: unknown
      try {
        ;(getActual() as () => unknown)()
      } catch (e) {
        error = e
      }
      assertThrow(error, arg)
    },
    toHaveBeenCalled: () => apply((a) => check(callsOf(a).length > 0, `mock to have been called`)),
    toHaveBeenCalledTimes: (n: number) =>
      apply((a) => check(callsOf(a).length === n, `mock to have been called ${n} time(s), got ${callsOf(a).length}`)),
    toHaveBeenCalledWith: (...args: unknown[]) =>
      apply((a) => {
        const pass = callsOf(a).some(
          (callArgs) => callArgs.length >= args.length && args.every((arg, i) => deepMatch(callArgs[i], arg, false)),
        )
        check(pass, `mock to have been called with ${fmt(args)}`)
      }),
    toHaveBeenLastCalledWith: (...args: unknown[]) =>
      apply((a) => {
        const calls = callsOf(a)
        const last = calls[calls.length - 1]
        const pass =
          last != null && last.length >= args.length && args.every((arg, i) => deepMatch(last[i], arg, false))
        check(pass, `mock to have been last called with ${fmt(args)}`)
      }),
  }
}

type Matchers = ReturnType<typeof buildMatchers>

export function expect(actual: unknown) {
  const base = buildMatchers(() => actual, false, 'none') as Matchers & {
    not: Matchers
    resolves: Matchers
    rejects: Matchers
  }
  Object.defineProperties(base, {
    not: { get: () => buildMatchers(() => actual, true, 'none') },
    resolves: { get: () => buildMatchers(() => actual, false, 'resolve') },
    rejects: { get: () => buildMatchers(() => actual, false, 'reject') },
  })
  return base
}

expect.stringContaining = (substring: string): Asym => ({
  $$asym: 'stringContaining',
  test: (actual) => typeof actual === 'string' && actual.includes(substring),
  toString: () => `stringContaining(${JSON.stringify(substring)})`,
})
