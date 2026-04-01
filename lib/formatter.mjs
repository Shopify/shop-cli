import { CURRENCY_SYMBOLS } from './currency.mjs';

export function formatProductsMarkdown(products) {
  if (typeof products === 'string') return products;

  return products
    .map((p, i) => {
      const parts = [`### ${i + 1}. ${p.brand ?? ''} ${p.title ?? 'Untitled'}`.trim()];
      if (p.price) {
        let line = `**Price:** ${p.price}`;
        if (p.converted_price) line += ` (${p.converted_price})`;
        parts.push(line);
      }
      if (p.rating) parts.push(`**Rating:** ${p.rating}`);
      if (p.description) parts.push(p.description);
      if (p.options) parts.push(p.options);
      if (p.product_url) parts.push(`View: ${p.product_url}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

export function formatMoney(price) {
  if (!price) return '—';
  const amount = parseFloat(price.amount).toFixed(2);
  const symbol = CURRENCY_SYMBOLS[price.currencyCode];
  return symbol ? `${symbol}${amount}` : `${amount} ${price.currencyCode}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatStatus(order) {
  return order.displayStatus || order.deliveryStatus || order.status || '—';
}

export function isTracker(item) {
  return item.__typename === 'Tracker';
}

export function formatItems(order) {
  const items = order.lineItems?.nodes || [];
  if (!items.length) return '—';
  if (items.length === 1) return `${items[0].title} x${items[0].quantity}`;
  return `${items[0].title} x${items[0].quantity} +${items.length - 1} more`;
}

export function formatItemsFull(order) {
  const items = order.lineItems?.nodes || [];
  return items.map(i => {
    const suffix = i.shopifyProductId ? ` (product: ${i.shopifyProductId})` : '';
    return `- ${i.title} x${i.quantity}${suffix}`;
  }).join('\n');
}

export function formatEta(order) {
  return order.etaInfo?.formattedEta || '—';
}

export function formatOrdersTable(orders, email) {
  if (!orders.length) return 'No orders found.';

  const today = formatDate(new Date().toISOString());
  const header = email ? `## Orders for ${email}\nToday: ${today}\n\n` : '';
  const rows = orders.map(o => {
    if (isTracker(o)) {
      const id = o.id || '—';
      const name = o.customName || o.name || '(tracked package)';
      const seller = o.sellerName || o.carrierInfo?.name || '—';
      const date = formatShortDate(o.createdAt);
      const status = o.status || '—';
      const eta = formatEta(o);
      const tracking = o.trackingCode || '—';
      return `| ${id} | ${name} | ${seller} | — | ${date} | — | ${status} | ${eta} | ${tracking} |`;
    }
    const uuid = o.uuid || '—';
    const name = `#${o.orderNumber}`;
    const shop = o.shop?.name || '—';
    const domain = o.shop?.myshopifyDomain || '—';
    const date = formatShortDate(o.createdAt);
    const total = formatMoney(o.totalPrice);
    const status = formatStatus(o);
    const eta = formatEta(o);
    const items = formatItems(o);
    return `| ${uuid} | ${name} | ${shop} | ${domain} | ${date} | ${total} | ${status} | ${eta} | ${items} |`;
  });

  return `${header}| ID | Order/Package | Shop/Seller | Domain | Date | Total | Status | ETA | Items/Tracking |
|------|-------|------|--------|------|-------|--------|-----|-------|
${rows.join('\n')}`;
}

export function formatOrderDetail(order) {
  const name = `#${order.orderNumber}`;
  const shop = order.shop?.name || 'Unknown';
  const status = formatStatus(order);
  const eta = formatEta(order);
  const placed = formatDate(order.createdAt);
  const total = formatMoney(order.totalPrice);
  const effective = formatMoney(order.effectiveTotalPrice);
  const refunded = order.totalRefunded?.amount > 0 ? formatMoney(order.totalRefunded) : null;

  let md = `## Order ${name} — ${shop}\n\n`;
  md += `**Status:** ${status}\n`;
  if (eta !== '—') md += `**ETA:** ${eta}\n`;
  md += `**Placed:** ${placed}\n`;
  md += `**Total:** ${total}`;
  if (effective !== total) md += ` (effective: ${effective})`;
  if (refunded) md += ` | Refunded: ${refunded}`;
  md += '\n';

  // Items
  const items = formatItemsFull(order);
  if (items) md += `\n### Items\n${items}\n`;

  // Tracking
  const trackers = order.trackers?.nodes || [];
  if (trackers.length) {
    md += '\n### Tracking\n';
    for (const t of trackers) {
      const carrier = t.carrierInfo?.name || 'Unknown carrier';
      const code = t.trackingCode || '—';
      const tStatus = t.status || '—';
      const tEta = t.etaInfo?.formattedEta || '';
      md += `- **${carrier}** | Code: ${code} | Status: ${tStatus}`;
      if (tEta) md += ` | ETA: ${tEta}`;
      md += '\n';
      if (t.trackingUrl) md += `  URL: ${t.trackingUrl}\n`;
    }
  }

  // Address
  const addr = order.shippingAddress;
  if (addr) {
    const parts = [addr.address1, addr.address2, addr.city, addr.zone, addr.country, addr.postalCode].filter(Boolean);
    if (parts.length) md += `\n### Shipping Address\n${parts.join(', ')}\n`;
  }

  // Links
  const links = [];
  const merchantUrl = order.shop?.websiteUrl
    ? new URL(order.shop.websiteUrl).origin
    : order.shop?.myshopifyDomain ? `https://${order.shop.myshopifyDomain}` : null;
  if (merchantUrl) links.push(`- Merchant website: ${merchantUrl}`);
  if (order.startReturnUrl) links.push(`- Start return: ${order.startReturnUrl}`);
  if (order.statusPageUrl) links.push(`- Order status page: ${order.statusPageUrl}`);
  if (order.externalOrderUrl) links.push(`- Store order page: ${order.externalOrderUrl}`);
  if (links.length) md += `\n### Links\n${links.join('\n')}\n`;

  return md;
}

export function formatTrackerDetail(tracker) {
  const name = tracker.customName || tracker.name || 'Tracked Package';
  const seller = tracker.sellerName || '—';
  const status = tracker.status || '—';
  const eta = tracker.etaInfo?.formattedEta || '—';
  const carrier = tracker.carrierInfo?.name || '—';
  const created = formatDate(tracker.createdAt);
  const delivered = tracker.deliveredAt ? formatDate(tracker.deliveredAt) : null;

  let md = `## ${name}\n\n`;
  if (seller !== '—') md += `**Seller:** ${seller}\n`;
  md += `**Status:** ${status}\n`;
  if (eta !== '—') md += `**ETA:** ${eta}\n`;
  md += `**Carrier:** ${carrier}\n`;
  if (tracker.trackingCode) md += `**Tracking code:** ${tracker.trackingCode}\n`;
  if (tracker.trackingUrl) md += `**Track:** ${tracker.trackingUrl}\n`;
  md += `**Added:** ${created}\n`;
  if (delivered) md += `**Delivered:** ${delivered}\n`;

  return md;
}

export function formatTrackingDetail(order) {
  const name = `#${order.orderNumber}`;
  const shop = order.shop?.name || 'Unknown';
  const status = formatStatus(order);
  const eta = formatEta(order);

  let md = `## Tracking — ${name} (${shop})\n\n`;
  md += `**Delivery Status:** ${status}\n`;
  if (eta !== '—') md += `**ETA:** ${eta}\n`;

  const trackers = order.trackers?.nodes || [];

  for (const t of trackers) {
    const carrier = t.carrierInfo?.name || 'Unknown carrier';
    md += `\n### ${carrier}\n`;
    if (t.trackingCode) md += `- **Tracking code:** ${t.trackingCode}\n`;
    if (t.status) md += `- **Status:** ${t.status}\n`;
    if (t.etaInfo?.formattedEta) md += `- **ETA:** ${t.etaInfo.formattedEta}\n`;
    if (t.trackingUrl) md += `- **Track:** ${t.trackingUrl}\n`;
  }

  if (order.statusPageUrl) md += `\n**Order status page:** ${order.statusPageUrl}\n`;

  return md;
}

export function formatReturnsInfo(order, policyInfo = null, policyText = null) {
  const name = `#${order.orderNumber}`;
  const shop = order.shop?.name || 'Unknown';

  let md = `## Returns — ${name} (${shop})\n\n`;

  const items = formatItemsFull(order);
  if (items) md += `### Items\n${items}\n\n`;

  if (policyInfo) {
    md += '### Return Policy\n';
    if (policyInfo.returnable === true) {
      md += '**Returnable:** Yes\n';
      if (policyInfo.returnWindowDays != null) {
        md += `**Return window:** ${policyInfo.returnWindowDays} days\n`;
      }
    } else if (policyInfo.returnable === false) {
      md += '**Returnable:** No\n';
    }
    md += '\n';
  }

  if (policyText) {
    md += '### Full Return Policy\n';
    md += policyText + '\n\n';
  }

  if (order.startReturnUrl) {
    md += `**Start a return:** ${order.startReturnUrl}\n`;
  } else if (!policyInfo) {
    md += 'No return link available for this order.\n';
  }

  if (order.statusPageUrl) {
    md += `**Order status page:** ${order.statusPageUrl}\n`;
  }

  return md;
}

function formatAmountWithCurrency(amount, currencyCode) {
  return formatMoney({ amount: amount.toFixed(2), currencyCode });
}

export function formatSpending(orders) {
  const actualOrders = orders.filter(o => !isTracker(o));
  if (!actualOrders.length) return 'No orders found for spending analysis.';

  // Group by merchant, then by currency within each merchant
  const merchantTotals = {};
  const currencyTotals = {};

  for (const o of actualOrders) {
    const gross = parseFloat(o.totalPrice?.amount || 0);
    const refunded = parseFloat(o.totalRefunded?.amount || 0);
    const amount = gross - refunded;
    if (amount <= 0) continue;
    const currency = o.totalPrice?.currencyCode || 'USD';
    const domain = o.shop?.myshopifyDomain || '—';
    const shopName = o.shop?.name || 'Unknown';
    const key = domain !== '—' ? domain : shopName;

    if (!merchantTotals[key]) merchantTotals[key] = { name: shopName, domain, orders: 0, byCurrency: {} };
    merchantTotals[key].orders++;
    merchantTotals[key].byCurrency[currency] = (merchantTotals[key].byCurrency[currency] || 0) + amount;

    if (!currencyTotals[currency]) currencyTotals[currency] = { orders: 0, total: 0 };
    currencyTotals[currency].orders++;
    currencyTotals[currency].total += amount;
  }

  // Sort merchants by total across all currencies
  const sorted = Object.entries(merchantTotals).sort((a, b) => {
    const aTotal = Object.values(a[1].byCurrency).reduce((s, v) => s + v, 0);
    const bTotal = Object.values(b[1].byCurrency).reduce((s, v) => s + v, 0);
    return bTotal - aTotal;
  });

  let md = `## By Merchant\n\n`;
  md += '| Shop Name | Domain | Orders | Total Spent |\n';
  md += '|-----------|--------|--------|-------------|\n';
  for (const [, data] of sorted) {
    const totals = Object.entries(data.byCurrency)
      .map(([cur, amt]) => formatAmountWithCurrency(amt, cur))
      .join(', ');
    md += `| ${data.name} | ${data.domain} | ${data.orders} | ${totals} |\n`;
  }

  md += `\n## Total\n\n`;
  const totalParts = Object.entries(currencyTotals).map(([cur, data]) => {
    const avg = data.total / data.orders;
    return `**${formatAmountWithCurrency(data.total, cur)}** across ${data.orders} orders (avg ${formatAmountWithCurrency(avg, cur)})`;
  });
  md += totalParts.join('\n');
  md += '\n';

  return md;
}

export function formatReorderOutput(order, checkoutUrl, items, skipped = []) {
  const shopName = order.shop?.name || 'Unknown';
  const domain = order.shop?.myshopifyDomain || order.shop?.websiteUrl || '—';

  let md = '';
  if (checkoutUrl) {
    md += `Checkout URL: ${checkoutUrl}\n`;
  } else {
    md += `This order can't be fully re-ordered — items may be out of stock or no longer sold.\n`;
  }

  if (items.length) {
    md += '\nItems:\n';
    for (const item of items) {
      md += `- ${item.title} x${item.quantity} — search: ${item.searchUrl}\n`;
    }
  }

  if (skipped.length) {
    md += '\nUnavailable:\n';
    for (const s of skipped) {
      md += `- ${s.title} — search: ${s.searchUrl}\n`;
    }
  }

  md += `\nStore: ${shopName} (${domain})\n`;
  return md;
}

export function formatConversion(result) {
  const fromSymbol = CURRENCY_SYMBOLS[result.from] || '';
  const toSymbol = CURRENCY_SYMBOLS[result.to] || '';
  const fromAmt = fromSymbol
    ? `${fromSymbol}${result.amount.toFixed(2)}`
    : result.amount.toFixed(2);
  const toAmt = toSymbol
    ? `${toSymbol}${result.result.toFixed(2)}`
    : result.result.toFixed(2);
  return `${fromAmt} ${result.from} = ${toAmt} ${result.to} (rate: ${result.rate}, ${result.date})`;
}
