import { fetchOrderById } from '../graphql.mjs';
import { formatReorderOutput } from '../formatter.mjs';

async function reorder(uuid, opts) {
  try {
    const order = await fetchOrderById(uuid);
    if (!order) {
      console.error('Order not found');
      process.exit(1);
    }

    const domain = order.shop?.myshopifyDomain
      || (order.shop?.websiteUrl ? new URL(order.shop.websiteUrl).hostname : null);

    if (!domain) {
      console.error('Could not determine store domain.');
      process.exit(1);
    }

    const lineItems = order.lineItems?.nodes || [];
    const items = [];
    const skipped = [];
    for (const node of lineItems) {
      const searchUrl = `https://${domain}/search?q=${encodeURIComponent(node.title || '')}`;
      const variantId = node.shopifyVariantId;
      if (!variantId) {
        skipped.push({ title: node.title || 'Unknown item', searchUrl });
        continue;
      }
      items.push({ variantId, quantity: node.quantity, title: node.title, searchUrl });
    }

    if (!items.length && !skipped.length) {
      console.error('No items from this order are available to re-order.');
      process.exit(1);
    }

    let checkoutUrl = null;
    if (order.canBuyAgain !== false && items.length) {
      const cartPath = items.map(i => `${i.variantId}:${i.quantity}`).join(',');
      checkoutUrl = `https://${domain}/cart/${cartPath}`;
    }

    console.log(formatReorderOutput(order, checkoutUrl, items, skipped));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function reorderCommand(program) {
  program
    .command('reorder <uuid>')
    .description('Re-order items from a previous order')
    .action(reorder);
}
