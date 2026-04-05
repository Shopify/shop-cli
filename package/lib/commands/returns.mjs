import { fetchOrderById, fetchReturnPolicy, fetchPolicyText } from '../graphql.mjs';
import { formatReturnsInfo } from '../formatter.mjs';

async function showReturns(uuid, opts) {
  try {
    const order = await fetchOrderById(uuid);
    if (!order) {
      console.error(`Order not found: ${uuid}`);
      process.exit(1);
    }

    const productId = (order.lineItems?.nodes || [])
      .map(n => n.shopifyProductId)
      .find(Boolean);

    let policyInfo = null;
    let policyText = null;

    if (productId) {
      policyInfo = await fetchReturnPolicy(productId);
      if (policyInfo?.embedUrl) {
        policyText = await fetchPolicyText(policyInfo.embedUrl);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({
        uuid: order.uuid,
        name: order.name,
        shop: order.shop?.name,
        lineItems: order.lineItems?.nodes || [],
        startReturnUrl: order.startReturnUrl,
        statusPageUrl: order.statusPageUrl,
        returnPolicy: policyInfo || null,
        returnPolicyText: policyText || null,
      }, null, 2));
    } else {
      console.log(formatReturnsInfo(order, policyInfo, policyText));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function returnsCommand(program) {
  program
    .command('returns <uuid>')
    .description('Show return info & links for an order')
    .option('--json', 'Output as JSON')
    .action(showReturns);
}
