import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatProductsMarkdown,
  formatMoney,
  formatDate,
  formatShortDate,
  formatStatus,
  isTracker,
  formatItems,
  formatItemsFull,
  formatEta,
  formatOrdersTable,
  formatOrderDetail,
  formatTrackerDetail,
  formatTrackingDetail,
  formatReturnsInfo,
  formatSpending,
  formatReorderOutput,
} from '../lib/formatter.mjs';
import {
  sampleOrder,
  minimalOrder,
  sampleTracker,
  deliveredTracker,
  minimalTracker,
  ordersForSpending,
} from './fixtures/orders.mjs';

// ── formatProductsMarkdown ───────────────────────────────────────────
describe('formatProductsMarkdown', () => {
  it('does not include shipping policy', () => {
    const products = [{
      brand: 'Nike', title: 'Shoes', price: '$99', product_url: 'https://store.com/shoes',
      policy: { shippingPolicyUrl: 'https://store.com/shipping', shippingPolicyText: 'Free shipping on orders over $50' },
    }];
    const md = formatProductsMarkdown(products);
    assert.ok(!md.includes('Shipping policy'));
    assert.ok(!md.includes('shipping'));
  });

  it('formats basic product fields', () => {
    const products = [{ brand: 'Nike', title: 'Shoes', price: '$99', product_url: 'https://store.com/shoes' }];
    const md = formatProductsMarkdown(products);
    assert.ok(md.includes('Nike Shoes'));
    assert.ok(md.includes('$99'));
    assert.ok(md.includes('https://store.com/shoes'));
  });
});

// ── formatMoney ──────────────────────────────────────────────────────
describe('formatMoney', () => {
  it('formats a USD price with $ symbol', () => {
    assert.equal(formatMoney({ amount: '49.99', currencyCode: 'USD' }), '$49.99');
  });

  it('returns dash for null', () => {
    assert.equal(formatMoney(null), '—');
  });

  it('returns dash for undefined', () => {
    assert.equal(formatMoney(undefined), '—');
  });

  it('formats CAD with CA$ symbol', () => {
    assert.equal(formatMoney({ amount: '0', currencyCode: 'CAD' }), 'CA$0.00');
  });

  it('formats GBP with £ symbol', () => {
    assert.equal(formatMoney({ amount: '11.54', currencyCode: 'GBP' }), '£11.54');
  });

  it('formats EUR with € symbol', () => {
    assert.equal(formatMoney({ amount: '77.00', currencyCode: 'EUR' }), '€77.00');
  });

  it('formats unknown currency with code suffix', () => {
    assert.equal(formatMoney({ amount: '100.00', currencyCode: 'SEK' }), '100.00 SEK');
  });

  it('rounds to two decimals', () => {
    assert.equal(formatMoney({ amount: '19.999', currencyCode: 'USD' }), '$20.00');
  });
});

// ── formatDate ───────────────────────────────────────────────────────
describe('formatDate', () => {
  it('formats valid ISO date', () => {
    const result = formatDate('2025-03-01T12:00:00Z');
    assert.match(result, /Mar\s+1,?\s+2025/);
  });

  it('returns dash for null', () => {
    assert.equal(formatDate(null), '—');
  });

  it('returns dash for undefined', () => {
    assert.equal(formatDate(undefined), '—');
  });
});

// ── formatShortDate ──────────────────────────────────────────────────
describe('formatShortDate', () => {
  it('formats without year', () => {
    const result = formatShortDate('2025-03-01T12:00:00Z');
    assert.match(result, /Mar\s+1/);
    assert.ok(!result.includes('2025'));
  });

  it('returns dash for null', () => {
    assert.equal(formatShortDate(null), '—');
  });
});

// ── formatStatus ─────────────────────────────────────────────────────
describe('formatStatus', () => {
  it('prefers displayStatus', () => {
    assert.equal(formatStatus({ displayStatus: 'Delivered', deliveryStatus: 'DONE', status: 'OK' }), 'Delivered');
  });

  it('falls back to deliveryStatus', () => {
    assert.equal(formatStatus({ deliveryStatus: 'IN_TRANSIT', status: 'OK' }), 'IN_TRANSIT');
  });

  it('falls back to status', () => {
    assert.equal(formatStatus({ status: 'CONFIRMED' }), 'CONFIRMED');
  });

  it('returns dash when all missing', () => {
    assert.equal(formatStatus({}), '—');
  });

  it('skips falsy displayStatus', () => {
    assert.equal(formatStatus({ displayStatus: '', deliveryStatus: 'SHIPPED' }), 'SHIPPED');
  });
});

// ── isTracker ────────────────────────────────────────────────────────
describe('isTracker', () => {
  it('returns true for Tracker typename', () => {
    assert.equal(isTracker({ __typename: 'Tracker' }), true);
  });

  it('returns false for Order typename', () => {
    assert.equal(isTracker({ __typename: 'Order' }), false);
  });

  it('returns false when typename missing', () => {
    assert.equal(isTracker({}), false);
  });
});

// ── formatItems ──────────────────────────────────────────────────────
describe('formatItems', () => {
  it('formats single item', () => {
    const order = { lineItems: { nodes: [{ title: 'Widget', quantity: 1 }] } };
    assert.equal(formatItems(order), 'Widget x1');
  });

  it('formats multiple items with +N more', () => {
    assert.equal(formatItems(sampleOrder), 'Widget x2 +1 more');
  });

  it('returns dash for empty items', () => {
    assert.equal(formatItems(minimalOrder), '—');
  });

  it('returns dash for missing lineItems', () => {
    assert.equal(formatItems({}), '—');
  });
});

// ── formatItemsFull ──────────────────────────────────────────────────
describe('formatItemsFull', () => {
  it('formats all items as list', () => {
    const result = formatItemsFull(sampleOrder);
    assert.equal(result, '- Widget x2 (product: 99991)\n- Gadget x1 (product: 99992)');
  });

  it('returns empty string for no items', () => {
    assert.equal(formatItemsFull(minimalOrder), '');
  });
});

// ── formatEta ────────────────────────────────────────────────────────
describe('formatEta', () => {
  it('returns formatted ETA', () => {
    assert.equal(formatEta(sampleOrder), 'Mar 5');
  });

  it('returns dash when missing', () => {
    assert.equal(formatEta({}), '—');
  });

  it('returns dash when etaInfo is null', () => {
    assert.equal(formatEta({ etaInfo: null }), '—');
  });
});

// ── formatOrdersTable ────────────────────────────────────────────────
describe('formatOrdersTable', () => {
  it('returns message for empty array', () => {
    assert.equal(formatOrdersTable([]), 'No orders found.');
  });

  it('includes email header when provided', () => {
    const result = formatOrdersTable([sampleOrder], 'user@example.com');
    assert.ok(result.startsWith('## Orders for user@example.com'));
  });

  it('omits email header when not provided', () => {
    const result = formatOrdersTable([sampleOrder]);
    assert.ok(!result.startsWith('##'));
    assert.ok(result.startsWith('|'));
  });

  it('renders an order row with domain', () => {
    const result = formatOrdersTable([sampleOrder]);
    assert.ok(result.includes('#1001'));
    assert.ok(result.includes('Cool Store'));
    assert.ok(result.includes('coolstore.myshopify.com'));
    assert.ok(result.includes('$49.99'));
    assert.ok(result.includes('Delivered'));
  });

  it('renders a tracker row', () => {
    const result = formatOrdersTable([sampleTracker]);
    assert.ok(result.includes('Birthday Gift'));
    assert.ok(result.includes('Amazon'));
    assert.ok(result.includes('IN_TRANSIT'));
    assert.ok(result.includes('9400111899223456789012'));
  });

  it('renders mixed orders and trackers', () => {
    const result = formatOrdersTable([sampleOrder, sampleTracker]);
    assert.ok(result.includes('#1001'));
    assert.ok(result.includes('Birthday Gift'));
  });
});

// ── formatOrderDetail ────────────────────────────────────────────────
describe('formatOrderDetail', () => {
  it('renders full order detail', () => {
    const md = formatOrderDetail(sampleOrder);
    assert.ok(md.includes('## Order #1001 — Cool Store'));
    assert.ok(md.includes('**Status:** Delivered'));
    assert.ok(md.includes('**ETA:** Mar 5'));
    assert.ok(md.includes('**Total:** $49.99'));
    assert.ok(md.includes('- Widget x2 (product: 99991)'));
    assert.ok(md.includes('- Gadget x1 (product: 99992)'));
    assert.ok(md.includes('**UPS**'));
    assert.ok(md.includes('1Z999AA10123456784'));
    assert.ok(md.includes('123 Main St'));
    assert.ok(md.includes('Merchant website: https://coolstore.myshopify.com'), 'should derive merchant URL from websiteUrl');
    assert.ok(md.includes('Start return:'));
    assert.ok(md.includes('Order status page:'));
    assert.ok(md.includes('Store order page:'));
  });

  it('shows refund when totalRefunded > 0', () => {
    const order = {
      ...sampleOrder,
      totalRefunded: { amount: '10.00', currencyCode: 'USD' },
    };
    const md = formatOrderDetail(order);
    assert.ok(md.includes('Refunded: $10.00'));
  });

  it('shows effective price when different from total', () => {
    const order = {
      ...sampleOrder,
      effectiveTotalPrice: { amount: '39.99', currencyCode: 'USD' },
    };
    const md = formatOrderDetail(order);
    assert.ok(md.includes('(effective: $39.99)'));
  });

  it('renders minimal order without crashing', () => {
    const md = formatOrderDetail(minimalOrder);
    assert.ok(md.includes('## Order #1002'));
    assert.ok(md.includes('Basic Shop'));
    assert.ok(!md.includes('### Tracking'));
    assert.ok(!md.includes('### Shipping Address'));
    assert.ok(!md.includes('### Links'));
  });
});

// ── formatTrackerDetail ──────────────────────────────────────────────
describe('formatTrackerDetail', () => {
  it('renders full tracker', () => {
    const md = formatTrackerDetail(sampleTracker);
    assert.ok(md.includes('## Birthday Gift'));
    assert.ok(md.includes('**Seller:** Amazon'));
    assert.ok(md.includes('**Status:** IN_TRANSIT'));
    assert.ok(md.includes('**ETA:** Mar 10'));
    assert.ok(md.includes('**Carrier:** USPS'));
    assert.ok(md.includes('**Tracking code:** 9400111899223456789012'));
    assert.ok(md.includes('**Track:**'));
  });

  it('renders delivered tracker with delivered date', () => {
    const md = formatTrackerDetail(deliveredTracker);
    assert.ok(md.includes('## Delivered Pkg'));
    assert.ok(md.includes('**Delivered:**'));
    assert.ok(!md.includes('**ETA:**'));
  });

  it('renders minimal tracker with defaults', () => {
    const md = formatTrackerDetail(minimalTracker);
    assert.ok(md.includes('## Tracked Package'));
    assert.ok(md.includes('**Status:** —'));
    assert.ok(md.includes('**Carrier:** —'));
    assert.ok(!md.includes('**Seller:**'));
    assert.ok(!md.includes('**Tracking code:**'));
  });
});

// ── formatTrackingDetail ─────────────────────────────────────────────
describe('formatTrackingDetail', () => {
  it('renders order with trackers', () => {
    const md = formatTrackingDetail(sampleOrder);
    assert.ok(md.includes('## Tracking — #1001 (Cool Store)'));
    assert.ok(md.includes('**Delivery Status:** Delivered'));
    assert.ok(md.includes('**ETA:** Mar 5'));
    assert.ok(md.includes('### UPS'));
    assert.ok(md.includes('1Z999AA10123456784'));
  });

  it('renders order without trackers', () => {
    const md = formatTrackingDetail(minimalOrder);
    assert.ok(md.includes('## Tracking — #1002'));
    assert.ok(!md.includes('### '));
  });

  it('includes statusPageUrl when present', () => {
    const md = formatTrackingDetail(sampleOrder);
    assert.ok(md.includes('**Order status page:**'));
    assert.ok(md.includes(sampleOrder.statusPageUrl));
  });

  it('omits statusPageUrl when absent', () => {
    const md = formatTrackingDetail(minimalOrder);
    assert.ok(!md.includes('**Order status page:**'));
  });
});

// ── formatReturnsInfo ────────────────────────────────────────────────
describe('formatReturnsInfo', () => {
  it('renders with return URL', () => {
    const md = formatReturnsInfo(sampleOrder);
    assert.ok(md.includes('## Returns — #1001 (Cool Store)'));
    assert.ok(md.includes('**Start a return:**'));
    assert.ok(md.includes(sampleOrder.startReturnUrl));
  });

  it('shows no-return message when URL absent', () => {
    const md = formatReturnsInfo(minimalOrder);
    assert.ok(md.includes('No return link available'));
  });

  it('includes items list', () => {
    const md = formatReturnsInfo(sampleOrder);
    assert.ok(md.includes('### Items'));
    assert.ok(md.includes('- Widget x2 (product: 99991)'));
  });

  it('includes statusPageUrl when present', () => {
    const md = formatReturnsInfo(sampleOrder);
    assert.ok(md.includes('**Order status page:**'));
  });

  it('renders return policy summary when returnable', () => {
    const md = formatReturnsInfo(sampleOrder, { returnable: true, returnWindowDays: 30, embedUrl: 'https://example.com/policy' });
    assert.ok(md.includes('### Return Policy'));
    assert.ok(md.includes('**Returnable:** Yes'));
    assert.ok(md.includes('**Return window:** 30 days'));
  });

  it('renders not returnable', () => {
    const md = formatReturnsInfo(sampleOrder, { returnable: false, returnWindowDays: null, embedUrl: null });
    assert.ok(md.includes('**Returnable:** No'));
    assert.ok(!md.includes('Return window'));
  });

  it('renders full policy text', () => {
    const md = formatReturnsInfo(sampleOrder, { returnable: true, returnWindowDays: 14 }, 'Items must be unused and in original packaging.');
    assert.ok(md.includes('### Full Return Policy'));
    assert.ok(md.includes('Items must be unused and in original packaging.'));
  });

  it('omits policy sections when policyInfo is null', () => {
    const md = formatReturnsInfo(sampleOrder);
    assert.ok(!md.includes('### Return Policy'));
    assert.ok(!md.includes('### Full Return Policy'));
  });
});

// ── formatReorderOutput ──────────────────────────────────────────────
describe('formatReorderOutput', () => {
  const order = {
    canBuyAgain: true,
    shop: { name: 'Cool Store', myshopifyDomain: 'coolstore.myshopify.com', websiteUrl: 'https://coolstore.myshopify.com' },
  };
  const items = [
    { variantId: '111', quantity: 2, title: 'Widget', searchUrl: 'https://coolstore.myshopify.com/search?q=Widget' },
    { variantId: '222', quantity: 1, title: 'Gadget', searchUrl: 'https://coolstore.myshopify.com/search?q=Gadget' },
  ];

  it('includes checkout URL and search links for each item', () => {
    const md = formatReorderOutput(order, 'https://store.com/cart/111:2,222:1', items);
    assert.ok(md.includes('Checkout URL: https://store.com/cart/111:2,222:1'));
    assert.ok(md.includes('Widget x2 — search:'));
    assert.ok(md.includes('Gadget x1 — search:'));
    assert.ok(!md.includes('Unavailable'));
    assert.ok(!md.includes("can't be fully re-ordered"));
  });

  it('shows unavailable message instead of checkout URL when checkoutUrl is null', () => {
    const unavailableOrder = { ...order, canBuyAgain: false };
    const md = formatReorderOutput(unavailableOrder, null, items);
    assert.ok(md.includes("can't be fully re-ordered"));
    assert.ok(!md.includes('Checkout URL:'));
    assert.ok(md.includes('Widget x2 — search:'));
  });

  it('shows skipped items with search links', () => {
    const skipped = [
      { title: 'Mystery Box', searchUrl: 'https://coolstore.myshopify.com/search?q=Mystery%20Box' },
    ];
    const md = formatReorderOutput(order, 'https://store.com/cart/111:2', items.slice(0, 1), skipped);
    assert.ok(md.includes('Unavailable:'));
    assert.ok(md.includes('Mystery Box — search:'));
  });

  it('shows store name and domain', () => {
    const md = formatReorderOutput(order, 'https://store.com/cart/111:2', items);
    assert.ok(md.includes('Store: Cool Store'));
    assert.ok(md.includes('coolstore.myshopify.com'));
  });
});

// ── formatSpending ───────────────────────────────────────────────────
describe('formatSpending', () => {
  it('returns message for empty array', () => {
    assert.equal(formatSpending([]), 'No orders found for spending analysis.');
  });

  it('calculates totals excluding refunded orders', () => {
    const md = formatSpending(ordersForSpending);
    // Net: 100 + 250.50 + 75.25 + (80-20) = 485.75, fully refunded $50 order skipped
    assert.ok(md.includes('$485.75'));
    assert.ok(md.includes('4 orders'));
  });

  it('sorts merchants by total descending', () => {
    const md = formatSpending(ordersForSpending);
    const storeB = md.indexOf('Store B');
    const storeA = md.indexOf('Store A');
    // Store B ($250.50) should appear before Store A ($235.25)
    assert.ok(storeB < storeA, 'Store B should come before Store A');
  });

  it('aggregates orders per merchant with net amounts', () => {
    const md = formatSpending(ordersForSpending);
    // Store A: 100 + 75.25 + 60 = $235.25 (3 orders)
    assert.ok(md.includes('$235.25'));
  });

  it('excludes fully refunded orders', () => {
    const md = formatSpending(ordersForSpending);
    // Fully refunded order ($50-$50) should not appear
    assert.ok(!md.includes('$50.00'));
  });

  it('calculates average on net amounts', () => {
    const md = formatSpending(ordersForSpending);
    // avg = 485.75 / 4 = 121.44
    assert.ok(md.includes('$121.44'));
  });

  it('handles single order', () => {
    const md = formatSpending([ordersForSpending[0]]);
    assert.ok(md.includes('$100.00'));
    assert.ok(md.includes('1 orders'));
  });

  it('shows both shop name and domain in merchant table', () => {
    const md = formatSpending(ordersForSpending);
    assert.ok(md.includes('Store A'));
    assert.ok(md.includes('store-a.myshopify.com'));
    assert.ok(md.includes('Store B'));
    assert.ok(md.includes('store-b.myshopify.com'));
  });
});
