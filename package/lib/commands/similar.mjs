import { similarProducts, normalizeProducts, readImageAsBase64 } from '../catalog.mjs';
import { convertPrice } from '../currency.mjs';
import { formatProductsMarkdown } from '../formatter.mjs';

async function runSimilar(opts) {
  try {
    if (opts.productId && opts.image) {
      console.error('Error: Provide either --product-id or --image, not both.');
      process.exit(1);
    }
    if (!opts.productId && !opts.image) {
      console.error('Error: One of --product-id or --image is required.');
      process.exit(1);
    }

    let similarTo;

    if (opts.image) {
      const imgData = readImageAsBase64(opts.image);
      similarTo = { media: { contentType: imgData.contentType, base64: imgData.base64 } };
    } else {
      // Auto-prefix bare IDs (from search results) with gid://shopify/p/
      const id = opts.productId.startsWith('gid://') ? opts.productId : `gid://shopify/p/${opts.productId}`;
      similarTo = { id };
    }

    const params = {
      ...(similarTo.id ? { id: similarTo.id } : { media: similarTo.media }),
      limit: opts.limit,
      ships_to: opts.shipsTo,
    };

    const response = await similarProducts(params);
    let products = normalizeProducts(response);

    if (opts.convertTo && Array.isArray(products)) {
      await Promise.all(products.map(async (p) => {
        if (p.price) p.converted_price = await convertPrice(p.price, opts.convertTo);
      }));
    }

    if (opts.json) {
      console.log(JSON.stringify(products, null, 2));
    } else {
      console.log(formatProductsMarkdown(products));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function similarCommand(program) {
  program
    .command('similar')
    .description('Find similar products by product ID or image')
    .option('--product-id <id>', 'Product ID from search results or gid://shopify/ProductVariant/...')
    .option('--image <path>', 'Path to an image file (must be <=1024px on longest edge)')
    .option('--limit <n>', 'Number of results (1-10)', '10')
    .option('--ships-to <code>', 'Ship-to country code', 'US')
    .option('--convert-to <code>', 'Convert prices to currency code')
    .option('--json', 'Output as JSON')
    .action(runSimilar);
}
