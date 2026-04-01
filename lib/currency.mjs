import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './auth.mjs';
const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1/latest';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const CURRENCY_SYMBOLS = {
  USD: '$', GBP: '\u00a3', EUR: '\u20ac', JPY: '\u00a5', CNY: '\u00a5',
  CAD: 'CA$', AUD: 'A$', KRW: '\u20a9', INR: '\u20b9',
};

// Reverse map: symbol -> currency code (longest symbols first to match CA$ before $)
const SYMBOL_TO_CURRENCY = Object.entries(CURRENCY_SYMBOLS)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([code, sym]) => ({ code, sym }));

export const SUPPORTED_CURRENCIES = [
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK',
  'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN',
  'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];

function cachePath(base) {
  return join(CONFIG_DIR, `rates-${base}.json`);
}

function readCache(base) {
  try {
    const data = JSON.parse(readFileSync(cachePath(base), 'utf-8'));
    const age = Date.now() - new Date(data.fetchedAt).getTime();
    if (age < CACHE_TTL_MS) return data;
  } catch {
    // cache miss or corrupt
  }
  return null;
}

function writeCache(base, date, rates) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const data = { fetchedAt: new Date().toISOString(), base, date, rates };
  writeFileSync(cachePath(base), JSON.stringify(data, null, 2), { mode: 0o600 });
}

const pendingFetches = new Map();

export async function fetchRates(base) {
  const cached = readCache(base);
  if (cached) return { base: cached.base, date: cached.date, rates: cached.rates };

  if (pendingFetches.has(base)) return pendingFetches.get(base);

  const promise = (async () => {
    const res = await fetch(`${FRANKFURTER_BASE}?base=${base}`);
    if (!res.ok) throw new Error(`Frankfurter API error: ${res.status} ${res.statusText}`);
    const json = await res.json();
    try { writeCache(base, json.date, json.rates); } catch { /* non-fatal */ }
    return { base, date: json.date, rates: json.rates };
  })();

  pendingFetches.set(base, promise);
  try {
    return await promise;
  } finally {
    pendingFetches.delete(base);
  }
}

export async function convert(amount, from, to) {
  if (from === to) {
    return { amount, from, to, rate: 1, result: parseFloat(amount.toFixed(2)), date: new Date().toISOString().slice(0, 10) };
  }
  const { date, rates } = await fetchRates(from);
  const rate = rates[to];
  if (rate == null) throw new Error(`Unsupported currency: ${to}`);
  const result = parseFloat((amount * rate).toFixed(2));
  return { amount, from, to, rate, result, date };
}

export async function convertPrice(priceStr, toCurrency) {
  if (!priceStr || typeof priceStr !== 'string') return null;

  const trimmed = priceStr.trim();
  let fromCurrency = null;
  let amountStr = null;

  // Try suffix pattern first: "49.99 USD"
  const suffixMatch = trimmed.match(/^([0-9.,]+)\s+([A-Z]{3})$/);
  if (suffixMatch) {
    amountStr = suffixMatch[1];
    fromCurrency = suffixMatch[2];
  }

  // Try symbol prefix: "$49.99", "CA$50.00", etc.
  if (!fromCurrency) {
    for (const { code, sym } of SYMBOL_TO_CURRENCY) {
      if (trimmed.startsWith(sym)) {
        fromCurrency = code;
        amountStr = trimmed.slice(sym.length);
        break;
      }
    }
  }

  if (!fromCurrency || !amountStr) return null;

  const amount = parseFloat(amountStr.replace(/,/g, ''));
  if (isNaN(amount)) return null;

  const { result } = await convert(amount, fromCurrency, toCurrency);
  const decimals = ['JPY', 'KRW'].includes(toCurrency) ? 0 : 2;
  return `~${result.toFixed(decimals)} ${toCurrency}`;
}
