function parseItem(raw) {
  const parts = raw.split(':');
  const id = parts[0];
  const qty = parts.length > 1 ? parseInt(parts[1], 10) : 1;

  if (!/^\d+$/.test(id)) {
    console.error(`Error: Invalid variant ID "${id}". Must be numeric.`);
    process.exit(1);
  }
  if (isNaN(qty) || qty < 1) {
    console.error(`Error: Invalid quantity "${parts[1]}" for variant ${id}. Must be a positive integer.`);
    process.exit(1);
  }

  return { id, qty };
}

async function checkout(rawItems, opts) {
  try {
    if (!opts.store) {
      console.error('Error: --store <url> is required.');
      process.exit(1);
    }

    const items = rawItems.map(parseItem);
    const cartPath = items.map(i => `${i.id}:${i.qty}`).join(',');

    const url = new URL(`/cart/${cartPath}`, opts.store);

    if (opts.email) url.searchParams.set('checkout[email]', opts.email);
    if (opts.city) url.searchParams.set('checkout[shipping_address][city]', opts.city);
    if (opts.country) url.searchParams.set('checkout[shipping_address][country]', opts.country);

    console.log(url.toString());
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function checkoutCommand(program) {
  program
    .command('checkout <items...>')
    .description('Build a checkout URL from variant IDs (format: VARIANT_ID:QTY)')
    .requiredOption('--store <url>', 'Store URL (e.g. https://example.myshopify.com)')
    .option('--email <email>', 'Pre-fill checkout email')
    .option('--city <city>', 'Pre-fill shipping city')
    .option('--country <code>', 'Pre-fill shipping country code')
    .action(checkout);
}
