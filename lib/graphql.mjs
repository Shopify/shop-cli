import { getValidToken } from './auth.mjs';

const GRAPHQL_URL = 'https://server.shop.app/graphql';

const ORDERS_QUERY = `
query OrdersList($count: Int!, $cursor: String) {
  ordersList(first: $count, after: $cursor, filter: { context: ORDER_HISTORY }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Order {
        uuid
        name
        orderNumber
        createdAt
        updatedAt
        totalPrice { amount currencyCode }
        effectiveTotalPrice { amount currencyCode }
        totalRefunded { amount currencyCode }
        deliveryStatus
        displayStatus
        deliveryType
        canBuyAgain
        shop { name myshopifyDomain websiteUrl }
        etaInfo { formattedEta estimatedTimeOfDelivery }
        lineItems { nodes { title quantity shopifyProductId shopifyVariantId image { url } } }
        trackers(first: 5) {
          nodes {
            trackingCode
            trackingUrl
            status
            carrierInfo { name }
            etaInfo { formattedEta }
          }
        }
        shippingAddress { address1 address2 city zone country postalCode }
        startReturnUrl
        statusPageUrl
        externalOrderUrl
      }
      ... on Tracker {
        id
        name
        customName
        sellerName
        trackingCode
        trackingUrl
        status
        carrierInfo { name }
        etaInfo { formattedEta estimatedTimeOfDelivery }
        createdAt
        updatedAt
        deliveredAt
        emailId
      }
    }
  }
}`;

export async function fetchOrders({ limit = 20, allPages = false } = {}) {
  const { accessToken } = await getValidToken();
  let allOrders = [];
  let cursor = null;
  const pageSize = Math.min(limit, 20);

  do {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { count: pageSize, cursor },
      }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors[0].message}`);
    }

    const list = json.data?.ordersList;
    if (!list) break;

    allOrders.push(...list.nodes);

    if (!allPages && allOrders.length >= limit) {
      allOrders = allOrders.slice(0, limit);
      break;
    }

    cursor = list.pageInfo.hasNextPage ? list.pageInfo.endCursor : null;
  } while (cursor);

  return allOrders;
}

export async function fetchOrderById(idOrUuid) {
  const items = await fetchOrders({ allPages: true });
  return items.find(o => o.uuid === idOrUuid || o.id === idOrUuid) || null;
}

export const VALID_STATUSES = [
  'PAID', 'FULFILLED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'ATTEMPTED_DELIVERY', 'REFUNDED',
];

const STOREFRONT_PRODUCT_QUERY = `
query StorefrontProduct($productId: ID!) {
  storefrontProduct(productInput: { productId: $productId }) {
    id
    title
    shop {
      id
      name
      policies { shippingPolicy { embedUrl } returnPolicy { embedUrl } }
      returnPolicySummary { returnable returnWindowDays }
    }
  }
}`;

async function fetchPoliciesViaGraphQL(productId) {
  try {
    const { accessToken } = await getValidToken();
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: STOREFRONT_PRODUCT_QUERY,
        variables: { productId: String(productId) },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors?.length) return null;

    const policies = json.data?.storefrontProduct?.shop?.policies;
    const shippingUrl = policies?.shippingPolicy?.embedUrl || null;
    const returnUrl = policies?.returnPolicy?.embedUrl || null;

    const [shippingText, returnText] = await Promise.all([
      shippingUrl ? fetchPolicyText(shippingUrl) : null,
      returnUrl ? fetchPolicyText(returnUrl) : null,
    ]);

    return {
      shippingPolicyText: shippingText,
      returnPolicyText: returnText,
      shippingPolicyUrl: shippingUrl,
      returnPolicyUrl: returnUrl,
    };
  } catch {
    return null;
  }
}

async function fetchPoliciesByDomain(domain) {
  const [shippingText, returnText] = await Promise.all([
    fetchPolicyText(`https://${domain}/policies/shipping-policy`),
    fetchPolicyText(`https://${domain}/policies/refund-policy`),
  ]);
  return {
    shippingPolicyText: shippingText,
    returnPolicyText: returnText,
    shippingPolicyUrl: shippingText ? `https://${domain}/policies/shipping-policy` : null,
    returnPolicyUrl: returnText ? `https://${domain}/policies/refund-policy` : null,
  };
}

export async function fetchShopPolicies(products) {
  try {
    if (!Array.isArray(products)) return new Map();

    // Deduplicate by shop_domain — policies are per-shop; pick first product_id per domain
    const domainInfo = new Map();
    for (const p of products) {
      if (!p.shop_domain) continue;
      if (!domainInfo.has(p.shop_domain)) {
        domainInfo.set(p.shop_domain, p.product_id || null);
      }
    }
    if (!domainInfo.size) return new Map();

    const result = new Map();
    const fetches = [...domainInfo].map(async ([domain, productId]) => {
      const policy = productId
        ? await fetchPoliciesViaGraphQL(productId)
        : await fetchPoliciesByDomain(domain);
      result.set(domain, policy || {
        shippingPolicyText: null,
        returnPolicyText: null,
        shippingPolicyUrl: null,
        returnPolicyUrl: null,
      });
    });
    await Promise.all(fetches);

    return result;
  } catch {
    return new Map();
  }
}

export async function fetchReturnPolicy(productId) {
  try {
    const { accessToken } = await getValidToken();
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: STOREFRONT_PRODUCT_QUERY,
        variables: { productId: String(productId) },
      }),
    });

    if (!res.ok) return null;

    const json = await res.json();
    if (json.errors?.length) return null;

    const product = json.data?.storefrontProduct;
    if (!product?.shop) return null;

    const summary = product.shop.returnPolicySummary;
    const embedUrl = product.shop.policies?.returnPolicy?.embedUrl || null;

    return {
      returnable: summary?.returnable ?? null,
      returnWindowDays: summary?.returnWindowDays ?? null,
      embedUrl,
    };
  } catch {
    return null;
  }
}

export function stripHtml(html) {
  let text = html;
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<(script|style|noscript|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return '\n' + '#'.repeat(Number(level)) + ' ' + content.trim() + '\n';
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/^[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export async function fetchPolicyText(embedUrl) {
  try {
    const res = await fetch(embedUrl);
    if (!res.ok) return null;
    const html = await res.text();
    return stripHtml(html);
  } catch {
    return null;
  }
}

export function filterOrders(orders, { since, until, status } = {}) {
  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;
  const s = status ? status.toUpperCase().replace(/\s+/g, '_') : null;

  return orders.filter(o => {
    const created = new Date(o.createdAt);
    if (sinceDate && created < sinceDate) return false;
    if (untilDate && created > untilDate) return false;
    if (s) {
      const orderStatus = (o.deliveryStatus || o.displayStatus || o.status || '')
        .toUpperCase().replace(/\s+/g, '_');
      if (orderStatus !== s) return false;
    }
    return true;
  });
}
