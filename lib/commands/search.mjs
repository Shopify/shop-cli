import { searchProducts, normalizeProducts } from '../catalog.mjs';
import { convertPrice } from '../currency.mjs';
import { formatProductsMarkdown } from '../formatter.mjs';

async function runSearch(query, opts) {
  try {
    const params = {
      query,
      limit: opts.limit,
      ships_to: opts.shipsTo,
      ships_from: opts.shipsFrom,
      min_price: opts.minPrice,
      max_price: opts.maxPrice,
      available_for_sale: 1,
      include_secondhand: opts.newOnly ? 0 : 1,
      categories: opts.categories,
      shop_ids: opts.shopIds,
      products_limit: opts.productsLimit,
    };

    const response = await searchProducts(params);
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

export function searchCommand(program) {
  program
    .command('search <query>')
    .description('Search the Shop.app product catalog')
    .option('--limit <n>', 'Number of results (1-10)', '10')
    .option('--ships-to <code>', 'Ship-to country code', 'US')
    .option('--ships-from <code>', 'Ship-from country code')
    .option('--min-price <n>', 'Minimum price')
    .option('--max-price <n>', 'Maximum price')
    .option('--new-only', 'Exclude secondhand items')
    .option('--categories <ids>', 'Shopify taxonomy category IDs (e.g. el-1,aa-3-2)')
    .option('--shop-ids <ids>', 'Numeric shop IDs (e.g. 123,456)')
    .option('--products-limit <n>', 'Products per shop', '10')
    .option('--convert-to <code>', 'Convert prices to currency code')
    .option('--json', 'Output as JSON')
    .action(runSearch);
}
