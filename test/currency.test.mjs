import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock node:fs before importing currency module
const mockReadFileSync = mock.fn();
const mockWriteFileSync = mock.fn();
const mockMkdirSync = mock.fn();

mock.module('node:fs', {
  namedExports: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
});

// Mock fetch globally
const mockFetch = mock.fn();
globalThis.fetch = mockFetch;

const { fetchRates, convert, convertPrice } = await import('../lib/currency.mjs');

const SAMPLE_RATES = { EUR: 0.86, GBP: 0.74, CAD: 1.36, JPY: 149.5 };

beforeEach(() => {
  mockReadFileSync.mock.resetCalls();
  mockWriteFileSync.mock.resetCalls();
  mockMkdirSync.mock.resetCalls();
  mockFetch.mock.resetCalls();

  // Default: cache miss
  mockReadFileSync.mock.mockImplementation(() => { throw new Error('ENOENT'); });
  mockWriteFileSync.mock.mockImplementation(() => {});
  mockMkdirSync.mock.mockImplementation(() => {});

  // Default: successful fetch
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ base: 'USD', date: '2026-03-23', rates: SAMPLE_RATES }),
  }));
});

// ── convert ─────────────────────────────────────────────────────────
describe('convert', () => {
  it('math is correct (100 USD -> EUR with rate 0.86 = 86.00)', async () => {
    const result = await convert(100, 'USD', 'EUR');
    assert.equal(result.result, 86.00);
  });

  it('returns proper structure with rate and date', async () => {
    const result = await convert(100, 'USD', 'EUR');
    assert.equal(result.amount, 100);
    assert.equal(result.from, 'USD');
    assert.equal(result.to, 'EUR');
    assert.equal(result.rate, 0.86);
    assert.equal(result.date, '2026-03-23');
    assert.equal(typeof result.result, 'number');
  });
});

// ── convertPrice ────────────────────────────────────────────────────
describe('convertPrice', () => {
  it('parses "$49.99" correctly', async () => {
    const result = await convertPrice('$49.99', 'EUR');
    assert.equal(result, '~42.99 EUR');
  });

  it('parses "\u00a3100.00" correctly', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ base: 'GBP', date: '2026-03-23', rates: { EUR: 1.16 } }),
    }));
    const result = await convertPrice('\u00a3100.00', 'EUR');
    assert.equal(result, '~116.00 EUR');
  });

  it('parses "CA$50.00" correctly', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ base: 'CAD', date: '2026-03-23', rates: { EUR: 0.63 } }),
    }));
    const result = await convertPrice('CA$50.00', 'EUR');
    assert.equal(result, '~31.50 EUR');
  });

  it('returns null for unparseable input', async () => {
    assert.equal(await convertPrice('free', 'EUR'), null);
    assert.equal(await convertPrice('', 'EUR'), null);
    assert.equal(await convertPrice(null, 'EUR'), null);
    assert.equal(await convertPrice(undefined, 'EUR'), null);
  });
});

// ── fetchRates ──────────────────────────────────────────────────────
describe('fetchRates', () => {
  it('uses cached data within 1hr', async () => {
    const freshCache = JSON.stringify({
      fetchedAt: new Date().toISOString(),
      base: 'USD',
      date: '2026-03-23',
      rates: SAMPLE_RATES,
    });
    mockReadFileSync.mock.mockImplementation(() => freshCache);

    const result = await fetchRates('USD');
    assert.deepEqual(result.rates, SAMPLE_RATES);
    assert.equal(result.base, 'USD');
    assert.equal(mockFetch.mock.callCount(), 0, 'should not call fetch when cache is fresh');
  });

  it('fetches fresh data when cache is stale', async () => {
    const staleCache = JSON.stringify({
      fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      base: 'USD',
      date: '2026-03-22',
      rates: { EUR: 0.80 },
    });
    mockReadFileSync.mock.mockImplementation(() => staleCache);

    const result = await fetchRates('USD');
    assert.equal(mockFetch.mock.callCount(), 1, 'should call fetch when cache is stale');
    assert.deepEqual(result.rates, SAMPLE_RATES);
    assert.equal(result.date, '2026-03-23');
  });

  it('writes cache after a fresh fetch', async () => {
    await fetchRates('USD');
    assert.equal(mockWriteFileSync.mock.callCount(), 1, 'should write cache file');
    const written = JSON.parse(mockWriteFileSync.mock.calls[0].arguments[1]);
    assert.equal(written.base, 'USD');
    assert.deepEqual(written.rates, SAMPLE_RATES);
    assert.ok(written.fetchedAt, 'should include fetchedAt timestamp');
  });

  it('still returns rates when cache write fails', async () => {
    mockWriteFileSync.mock.mockImplementation(() => { throw new Error('EACCES'); });
    const result = await fetchRates('USD');
    assert.deepEqual(result.rates, SAMPLE_RATES, 'should return rates even if cache write fails');
    assert.equal(result.base, 'USD');
  });

  it('deduplicates concurrent calls for the same base currency', async () => {
    const results = await Promise.all([
      fetchRates('USD'),
      fetchRates('USD'),
      fetchRates('USD'),
    ]);
    assert.equal(mockFetch.mock.callCount(), 1, 'should only call fetch once for concurrent requests');
    for (const r of results) {
      assert.deepEqual(r.rates, SAMPLE_RATES);
    }
  });
});
