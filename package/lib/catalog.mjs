import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const SEARCH_URL = 'https://shop.app/web/api/catalog/search';

export async function searchProducts(opts = {}) {
  if (!opts.query) throw new Error('query is required');

  const params = new URLSearchParams();
  params.set('query', opts.query);
  params.set('limit', String(Math.max(1, Math.min(10, opts.limit ?? 10))));
  params.set('ships_to', opts.ships_to ?? 'US');
  params.set('available_for_sale', String(opts.available_for_sale ?? 1));
  params.set('include_secondhand', String(opts.include_secondhand ?? 1));
  params.set('products_limit', String(opts.products_limit ?? 10));

  if (opts.ships_from != null) params.set('ships_from', opts.ships_from);
  if (opts.min_price != null) params.set('min_price', String(opts.min_price));
  if (opts.max_price != null) params.set('max_price', String(opts.max_price));
  if (opts.categories != null) {
    if (/^\d+(,\d+)*$/.test(opts.categories)) {
      throw new Error('categories must be Shopify taxonomy IDs (e.g. "el-1,aa-3-2"), not numeric IDs');
    }
    params.set('categories', opts.categories);
  }
  if (opts.shop_ids != null) {
    const ids = String(opts.shop_ids);
    if (/[a-z]/i.test(ids) && ids.includes('.')) {
      throw new Error('shop_ids must be numeric shop IDs (e.g. "123,456"), not domains');
    }
    params.set('shop_ids', ids);
  }

  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Catalog search failed: ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  const raw = await res.text();
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function similarProducts(opts = {}) {
  const body = {};

  if (opts.id) {
    body.similarTo = { id: opts.id };
  } else if (opts.media) {
    body.similarTo = { media: opts.media };
  } else {
    throw new Error('Either id or media is required for similarProducts');
  }

  if (opts.limit != null) body.limit = opts.limit;
  if (opts.ships_to != null) body.ships_to = opts.ships_to;

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Similar products search failed: ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  const raw = await res.text();
  try { return JSON.parse(raw); } catch { return raw; }
}

const EXT_TO_CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function readImageAsBase64(filePath) {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
  const base64 = buf.toString('base64');

  let width = null;
  let height = null;

  if (ext === '.png' && buf.length >= 24) {
    width = buf.readUInt32BE(16);
    height = buf.readUInt32BE(20);
  } else if (ext === '.jpg' || ext === '.jpeg') {
    // Scan for SOF markers (SOF0-SOF3: 0xC0-0xC3) to support baseline and progressive
    for (let i = 0; i < buf.length - 9; i++) {
      if (buf[i] === 0xff && buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3) {
        height = buf.readUInt16BE(i + 5);
        width = buf.readUInt16BE(i + 7);
        break;
      }
    }
  }

  return { contentType, base64, width, height };
}

/**
 * Parse the markdown text returned by the catalog API into structured product objects.
 */
export function parseMarkdownProducts(text) {
  if (!text || typeof text !== 'string') return [];

  const blocks = text.split(/\n\n---(?:\n\n|\s*$)/).filter(b => b.trim());
  return blocks.map(parseOneProduct).filter(Boolean);
}

function parseOneProduct(block) {
  const lines = block.split('\n');
  if (lines.length < 3) return null;

  const title = lines[0]?.trim() || null;

  // Line 2: "$79.00 USD at POPFLEX® — 4.7/5 (563 reviews)"
  const priceLine = lines[1] || '';
  const priceMatch = priceLine.match(/^(.+?)\s+at\s+(.+?)(?:\s+—\s+(.+))?$/);
  const price = priceMatch?.[1]?.trim() || null;
  const brand = priceMatch?.[2]?.trim() || null;
  const rating = priceMatch?.[3]?.trim() || null;

  // Remaining lines: extract tagged fields
  let product_url = null;
  let image_url = null;
  let product_id = null;
  let checkout_url = null;
  const descParts = [];
  const optionParts = [];
  let pastId = false;
  let pastBlankAfterId = false;

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('Img: ')) {
      image_url = trimmed.slice(5).trim();
    } else if (trimmed.startsWith('id: ')) {
      product_id = trimmed.slice(4).trim();
      pastId = true;
    } else if (trimmed.startsWith('Checkout: ')) {
      checkout_url = trimmed.slice(10).trim();
    } else if (!product_url && /^https?:\/\//.test(trimmed) && !trimmed.startsWith('Img:')) {
      product_url = trimmed;
    } else if (pastId) {
      // After the id line: first blank line is a separator, then description, then options/specs
      if (!pastBlankAfterId && trimmed === '') {
        pastBlankAfterId = true;
      } else if (pastBlankAfterId) {
        if (/^(Features:|Specs:|— |Exercise |Headphone |Microphone |Connectivity |Pattern:|Audio |Color:|Earphone )/.test(trimmed)) {
          optionParts.push(trimmed);
        } else if (trimmed !== '' && !descParts.length && !optionParts.length) {
          descParts.push(trimmed);
        } else if (trimmed !== '' && optionParts.length) {
          optionParts.push(trimmed);
        } else if (trimmed !== '' && descParts.length) {
          // Could be continuation of description or start of options
          descParts.push(trimmed);
        }
      }
    }
  }

  let variant_id = null;
  let shop_domain = null;
  if (product_url) {
    try {
      const u = new URL(product_url);
      variant_id = u.searchParams.get('variant') || null;
      shop_domain = u.hostname;
    } catch { /* ignore malformed URLs */ }
  }

  // Fix {id} placeholder in checkout URL
  if (checkout_url && variant_id) {
    checkout_url = checkout_url.replace('{id}', variant_id);
  }

  return {
    image_url,
    title,
    brand,
    price,
    converted_price: null,
    rating,
    description: descParts.join('\n') || null,
    options: optionParts.join('\n') || null,
    product_url,
    checkout_url,
    variant_id,
    product_id,
    shop_domain,
  };
}

export function normalizeProducts(apiResponse) {
  if (typeof apiResponse === 'string') return parseMarkdownProducts(apiResponse);

  // JSON response — normalize to standard product objects
  const products = Array.isArray(apiResponse) ? apiResponse : apiResponse?.products ?? [];
  return products.map((p) => ({
    image_url: p.image_url ?? p.imageUrl ?? p.image ?? null,
    title: p.title ?? p.name ?? null,
    brand: p.brand ?? p.vendor ?? null,
    price: p.price ?? null,
    converted_price: p.converted_price ?? p.convertedPrice ?? null,
    rating: p.rating ?? null,
    description: p.description ?? null,
    options: p.options ?? null,
    product_url: p.product_url ?? p.productUrl ?? p.url ?? null,
    checkout_url: p.checkout_url ?? p.checkoutUrl ?? null,
    variant_id: p.variant_id ?? p.variantId ?? null,
    product_id: p.product_id ?? p.productId ?? p.id ?? null,
    shop_domain: p.shop_domain ?? p.shopDomain ?? null,
  }));
}

export function attachPolicies(products, policyMap) {
  if (!Array.isArray(products)) return products;
  return products.map(p => ({
    ...p,
    policy: policyMap.get(p.shop_domain) ?? null,
  }));
}
