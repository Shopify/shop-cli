import { getValidToken } from '../auth.mjs';
import { fetchOrders, fetchOrderById, filterOrders, VALID_STATUSES } from '../graphql.mjs';
import { formatOrdersTable, formatOrderDetail, formatTrackerDetail, isTracker } from '../formatter.mjs';

function validateDate(value, name) {
  if (!value) return;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    console.error(`Error: Invalid date for ${name}: "${value}". Use YYYY-MM-DD format.`);
    process.exit(1);
  }
}

function validateLimit(value) {
  const n = parseInt(value);
  if (isNaN(n) || n < 1) {
    console.error('Error: Limit must be a positive number.');
    process.exit(1);
  }
  return n;
}

function validateStatus(value) {
  if (!value) return;
  const normalized = value.toUpperCase().replace(/\s+/g, '_');
  if (!VALID_STATUSES.includes(normalized)) {
    console.error(`Error: Unknown status "${value}". Valid statuses: ${VALID_STATUSES.map(s => s.toLowerCase()).join(', ')}`);
    process.exit(1);
  }
}

async function listOrders(opts) {
  try {
    validateDate(opts.since, '--since');
    validateDate(opts.until, '--until');
    validateStatus(opts.status);
    const limit = validateLimit(opts.limit);

    const { userinfo } = await getValidToken();
    const hasFilters = !!(opts.since || opts.until || opts.status);

    let orders = await fetchOrders({ limit: hasFilters ? 100 : limit, allPages: hasFilters });
    orders = filterOrders(orders, {
      since: opts.since,
      until: opts.until,
      status: opts.status,
    });
    orders = orders.slice(0, limit);

    if (opts.json) {
      console.log(JSON.stringify(orders, null, 2));
    } else {
      console.log(formatOrdersTable(orders, userinfo.email));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function showOrder(idOrUuid, opts) {
  try {
    const item = await fetchOrderById(idOrUuid);
    if (!item) {
      console.error(`Order/tracker not found: ${idOrUuid}`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(item, null, 2));
    } else {
      console.log(isTracker(item) ? formatTrackerDetail(item) : formatOrderDetail(item));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function ordersCommand(program) {
  program
    .command('orders')
    .description('List your recent orders')
    .option('--since <date>', 'Filter orders since date (YYYY-MM-DD)')
    .option('--until <date>', 'Filter orders until date (YYYY-MM-DD)')
    .option('--status <status>', 'Filter by delivery status (e.g. in_transit, delivered)')
    .option('--limit <n>', 'Maximum number of orders to show', '20')
    .option('--json', 'Output as JSON')
    .action(listOrders);

  program
    .command('order <id>')
    .description('Show detailed info for a specific order or tracked package')
    .option('--json', 'Output as JSON')
    .action(showOrder);
}
