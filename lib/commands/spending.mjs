import { fetchOrders, filterOrders } from '../graphql.mjs';
import { formatSpending } from '../formatter.mjs';

function validateDate(value, name) {
  if (!value) return;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    console.error(`Error: Invalid date for ${name}: "${value}". Use YYYY-MM-DD format.`);
    process.exit(1);
  }
}

async function showSpending(opts) {
  try {
    validateDate(opts.since, '--since');
    validateDate(opts.until, '--until');

    let orders = await fetchOrders({ allPages: true });
    if (opts.since || opts.until) {
      orders = filterOrders(orders, { since: opts.since, until: opts.until });
    }
    console.log(formatSpending(orders));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function spendingCommand(program) {
  program
    .command('spending')
    .description('Show spending by merchant and total')
    .option('--since <date>', 'Only include orders since date (YYYY-MM-DD)')
    .option('--until <date>', 'Only include orders until date (YYYY-MM-DD)')
    .action(showSpending);
}
