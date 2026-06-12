import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

import { Command } from 'commander'

import { AuthClient } from './auth.js'
import { CLI_VERSION, COUNTRY_ACCOUNT, DEFAULT_COUNTRY } from './constants.js'
import { toErrorMessage } from './errors.js'
import { renderCatalogResult, renderCheckoutMessages } from './render.js'
import { ShopCatalogClient } from './shop-client.js'
import { clearStoredAuth, KeytarSecretStore, MemorySecretStore, setCountry } from './storage.js'
import type { FetchLike, SecretStore } from './types.js'

export interface CliDependencies {
  fetch?: FetchLike
  store?: SecretStore
  stdin?: NodeJS.ReadStream | AsyncIterable<Buffer | string>
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  stderr?: Pick<NodeJS.WriteStream, 'write'>
  exit?: (code: number) => never
}

type OutputFormat = 'md' | 'json'

interface GlobalOptions {
  country?: string
  profileUrl?: string
  memoryStore?: boolean
  format?: OutputFormat
}

export function createProgram(deps: CliDependencies = {}): Command {
  const program = new Command()
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const exit = deps.exit ?? ((code: number): never => process.exit(code))

  program
    .name('shop')
    .description('Shop personal shopping CLI for catalog search, auth, checkout, and order search')
    .version(CLI_VERSION)
    .option('--country <code>', 'Buyer country for this call (catalog context signal, not a ships-to filter). Transient; use `shop config set-country` to persist a default.', DEFAULT_COUNTRY)
    .option('--profile-url <url>', 'UCP agent profile URL for global catalog calls')
    .option('--memory-store', 'Use in-memory token storage for tests and dry runs')
    .option('--format <format>', 'Output format for catalog results: md (default) or json. Auth and checkout always emit JSON; orders emit markdown.', parseFormat, 'md')
    .showHelpAfterError()

  program
    .command('search')
    .description('Search the Shopify global catalog by text, similar items (--like-id), or image (--image)')
    .argument('[query]', 'Search query (optional when using --like-id or --image)')
    .option('--country <code>', 'Buyer country')
    .option('-l, --limit <number>', 'Results per page, 1-50 (keep small; 6-8 is plenty, large pages burn tokens)', parseLimit)
    .option('--cursor <cursor>', 'Pagination cursor from a previous search response (re-run the same query to fetch the next page)')
    .option('--min-price <minorUnits>', 'Minimum price in minor currency units', parsePrice)
    .option('--max-price <minorUnits>', 'Maximum price in minor currency units', parsePrice)
    .option('--currency <code>', 'Currency signal')
    .option('--language <code>', 'Language signal')
    .option('--intent <text>', 'Buyer intent context')
    .option('--include-unavailable', 'Include unavailable products')
    .option('--condition <list>', 'Comma-separated conditions, e.g. new,secondhand', commaList)
    .option('--ships-from <list>', 'Comma-separated merchant origin countries (ISO2), e.g. US,CA', commaList)
    .option('--ships-to <code>', 'Filter to products that ship to this country (ISO alpha-2). Also localizes the catalog context to this country unless --country is set (required for the filter to be enforced).')
    .option('--ships-to-region <code>', 'ships-to region (requires --ships-to)')
    .option('--ships-to-postal <code>', 'ships-to postal code (requires --ships-to)')
    .option('--shop-id <id...>', 'Filter to shop IDs')
    .option('--category <id...>', 'Filter to taxonomy category IDs')
    .option('--color <list>', 'Comma-separated color attribute values, e.g. White,Blue', commaList)
    .option('--size <list>', 'Comma-separated size attribute values, e.g. M,L', commaList)
    .option('--gender <list>', 'Comma-separated target gender attribute values, e.g. Female,Male', commaList)
    .option('--like-id <id...>', 'Find similar items by product or variant ID')
    .option('--image <path>', 'Find similar items by image file path (or inline <mime>:<base64>)')
    .option('--view <name>', 'Catalog response view')
    .action(async (query: string | undefined, options) => {
      await runCatalogAction({ stdout, stderr, exit }, 'search_catalog', program, async () => {
        const client = resolveClient(deps, program)
        return client.searchCatalog({
          query,
          like: buildLike(options.likeId, options.image),
          country: options.country,
          limit: options.limit,
          cursor: options.cursor,
          minPrice: options.minPrice,
          maxPrice: options.maxPrice,
          currency: options.currency,
          language: options.language,
          intent: options.intent,
          // Omit the availability filter to include unavailable products; otherwise restrict to available.
          available: options.includeUnavailable ? undefined : true,
          condition: options.condition,
          shipsFrom: options.shipsFrom,
          shipsTo: buildShipsTo(options.shipsTo, options.shipsToRegion, options.shipsToPostal),
          shopIds: options.shopId,
          categories: options.category,
          color: options.color,
          size: options.size,
          gender: options.gender,
          view: options.view,
        })
      })
    })

  const catalog = program
    .command('catalog')
    .description('Direct global catalog MCP tools (lookup and product detail; use `shop search` to search)')

  catalog
    .command('lookup')
    .description('Look up product or variant IDs in the global catalog')
    .argument('<ids...>', 'Product or variant IDs')
    .option('--country <code>', 'Buyer country')
    .option('--currency <code>', 'Currency signal')
    .option('--ships-to <code>', 'Filter to products that ship to this country (ISO alpha-2)')
    .option('--ships-to-region <code>', 'ships-to region (requires --ships-to)')
    .option('--ships-to-postal <code>', 'ships-to postal code (requires --ships-to)')
    .option('--include-unavailable', 'Include unavailable products')
    .option('--condition <list>', 'Comma-separated conditions', commaList)
    .option('--view <name>', 'Catalog response view')
    .action(async (ids: string[], options) => {
      await runCatalogAction({ stdout, stderr, exit }, 'lookup_catalog', program, async () =>
        resolveClient(deps, program).lookupCatalog({
          ids,
          country: options.country,
          currency: options.currency,
          shipsTo: buildShipsTo(options.shipsTo, options.shipsToRegion, options.shipsToPostal),
          // Omit the availability filter to include unavailable products; otherwise restrict to available.
          available: options.includeUnavailable ? undefined : true,
          condition: options.condition,
          view: options.view,
        }),
      )
    })

  catalog
    .command('get-product')
    .alias('get_product')
    .description('Get a full product detail record')
    .argument('<id>', 'Product or variant ID')
    .option('--country <code>', 'Buyer country')
    .option('--currency <code>', 'Currency signal')
    .option('--select <name=label...>', 'Variant option selection')
    .option('--preference <name...>', 'Variant relaxation priority')
    .option('--view <name>', 'Catalog response view')
    .action(async (id: string, options) => {
      await runCatalogAction({ stdout, stderr, exit }, 'get_product', program, async () =>
        resolveClient(deps, program).getProduct({
          id,
          country: options.country,
          currency: options.currency,
          selected: parseSelections(options.select),
          preferences: options.preference,
          view: options.view,
        }),
      )
    })

  const auth = program.command('auth').description('Shop account authentication')

  auth
    .command('login')
    .description('Run Shop device authorization and store tokens in the OS secret store')
    .option('--device-name <name>', 'Name shown in Shop Connections')
    .action(async (options) => {
      await runAction({ stdout, stderr, exit }, async () => {
        const globals = program.optsWithGlobals<GlobalOptions>()
        const store = resolveStore(deps, globals)
        const authClient = new AuthClient({
          fetch: deps.fetch,
          store,
          deviceName: options.deviceName,
          onDeviceCode: ({ verificationUriComplete, userCode }) => {
            stderr.write(
              `Open this URL to authorize Shop CLI: ${verificationUriComplete}\nUser code: ${userCode}\n`,
            )
          },
        })
        const client = new ShopCatalogClient({ fetch: deps.fetch, store, auth: authClient })
        return client.login()
      })
    })

  auth
    .command('device-code')
    .description('Begin sign-in: print the Shop authorization URL and save pending state (does not block)')
    .option('--device-name <name>', 'Name shown in Shop Connections')
    .action(async (options) => {
      await runAction({ stdout, stderr, exit }, async () => {
        const store = resolveStore(deps, program.optsWithGlobals<GlobalOptions>())
        const authClient = new AuthClient({ fetch: deps.fetch, store, deviceName: options.deviceName })
        const message = await authClient.startDeviceAuthorization()
        return {
          verification_uri_complete: message.verificationUriComplete,
          user_code: message.userCode,
          expires_in: message.expiresIn,
          next: 'After the user authorizes in the browser, run `shop auth poll` to store tokens.',
        }
      })
    })

  auth
    .command('poll')
    .description('Exchange the pending device authorization for tokens and store them. Re-run while pending.')
    .action(async () => {
      await runAction({ stdout, stderr, exit }, async () => {
        const store = resolveStore(deps, program.optsWithGlobals<GlobalOptions>())
        const authClient = new AuthClient({ fetch: deps.fetch, store })
        const result = await authClient.completeDeviceAuthorization()
        switch (result.status) {
          case 'authenticated':
            return new ShopCatalogClient({ fetch: deps.fetch, store, auth: authClient }).status()
          case 'pending':
            return {
              authenticated: false,
              status: 'pending',
              message: 'Authorization still pending. Ask the user to finish signing in, then run `shop auth poll` again.',
            }
          case 'expired':
            return {
              authenticated: false,
              status: 'expired',
              message: 'The sign-in link expired. Run `shop auth device-code` to start over.',
            }
          case 'denied':
            return {
              authenticated: false,
              status: 'denied',
              message: 'The user declined the sign-in request.',
            }
          default:
            return {
              authenticated: false,
              status: 'no_pending',
              message: 'No pending device authorization. Run `shop auth device-code` first.',
            }
        }
      })
    })

  auth
    .command('status')
    .description('Check whether stored Shop auth is valid')
    .action(async () => {
      await runAction({ stdout, stderr, exit }, async () =>
        resolveClient(deps, program).status(),
      )
    })

  auth
    .command('logout')
    .description('Delete stored Shop tokens and preferences')
    .action(async () => {
      await runAction({ stdout, stderr, exit }, async () => {
        await clearStoredAuth(resolveStore(deps, program.optsWithGlobals<GlobalOptions>()))
        return { ok: true }
      })
    })

  const checkout = program.command('checkout').description('Create and complete UCP checkout')

  checkout
    .command('create')
    .description('Create a checkout from checkout JSON, optionally adding a product variant')
    .requiredOption('--shop-domain <domain>', 'Merchant shop domain')
    .option('--variant-id <id>', 'Product variant ID or gid')
    .option('-q, --quantity <number>', 'Quantity', parseQuantity, 1)
    .option('--checkout-stdin', 'Merge a checkout JSON object read from stdin')
    .option('--buyer-ip <ip>', 'Buyer public IP, forwarded to the merchant for checkout fraud/risk checks (auto-detected via api.ipify.org; override here or with SHOP_BUYER_IP)')
    .action(async (options) => {
      await runCheckoutAction({ stdout, stderr, exit }, async () => {
        const checkout = options.checkoutStdin ? await readJsonFromStdin(deps.stdin ?? process.stdin) : undefined
        if (!options.variantId && !checkout) {
          throw new Error('checkout create requires --variant-id or --checkout-stdin')
        }
        return resolveClient(deps, program).createCheckout({
          shopDomain: options.shopDomain,
          variantId: options.variantId,
          quantity: options.quantity,
          checkout,
          buyerIp: options.buyerIp,
        })
      })
    })

  checkout
    .command('update')
    .description('Update checkout details from a checkout JSON object on stdin')
    .requiredOption('--shop-domain <domain>', 'Merchant shop domain')
    .requiredOption('--checkout-id <id>', 'Checkout ID')
    .requiredOption('--checkout-stdin', 'Read checkout update JSON from stdin')
    .option('--buyer-ip <ip>', 'Buyer public IP, forwarded to the merchant for checkout fraud/risk checks (auto-detected via api.ipify.org; override here or with SHOP_BUYER_IP)')
    .action(async (options) => {
      await runCheckoutAction({ stdout, stderr, exit }, async () =>
        resolveClient(deps, program).updateCheckout({
          shopDomain: options.shopDomain,
          checkoutId: options.checkoutId,
          checkout: await readJsonFromStdin(deps.stdin ?? process.stdin),
          buyerIp: options.buyerIp,
        }),
      )
    })

  checkout
    .command('complete')
    .description('Complete checkout by echoing back the payment instruments from the create_checkout response')
    .requiredOption('--shop-domain <domain>', 'Merchant shop domain')
    .requiredOption('--checkout-id <id>', 'Checkout ID')
    .requiredOption('--checkout-stdin', 'Read the create_checkout response JSON (or its payment block) from stdin to source the payment instruments')
    .requiredOption('--idempotency-key <key>', 'Fresh key for this purchase intent')
    .option('--confirm', 'Authorize this purchase after confirming details with the user; required to complete')
    .option('--buyer-ip <ip>', 'Buyer public IP, forwarded to the merchant for checkout fraud/risk checks (auto-detected via api.ipify.org; override here or with SHOP_BUYER_IP)')
    .action(async (options) => {
      await runAction({ stdout, stderr, exit }, async () => {
        if (!options.confirm) {
          throw new Error(
            'Refusing to complete checkout without --confirm. Verify the item, variant, quantity, price, shipping, and total cost with the user, then re-run with --confirm to authorize this purchase.',
          )
        }
        const checkout = await readJsonFromStdin(deps.stdin ?? process.stdin)
        return resolveClient(deps, program).completeCheckout({
          shopDomain: options.shopDomain,
          checkoutId: options.checkoutId,
          instruments: extractInstruments(checkout),
          idempotencyKey: options.idempotencyKey,
          buyerIp: options.buyerIp,
        })
      })
    })

  const orders = program.command('orders').description('Search Shop orders')

  orders
    .command('search')
    .description('Search recent orders, tracking, order info, returns, or reorder candidates')
    .requiredOption('--type <type>', 'recent, tracking, order_info, returns, or reorder')
    .option('--query <text>', 'Search terms')
    .option('--date-from <date>', 'Inclusive start date YYYY-MM-DD')
    .option('--date-to <date>', 'Inclusive end date YYYY-MM-DD')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options) => {
      await runTextAction({ stdout, stderr, exit }, async () =>
        resolveClient(deps, program).searchOrders({
          type: parseOrderType(options.type),
          query: options.query,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          cursor: options.cursor,
        }),
      )
    })

  const config = program.command('config').description('Manage stored CLI preferences')

  config
    .command('set-country')
    .description('Persist a default buyer country used when --country is not passed')
    .argument('<code>', 'ISO 3166-1 alpha-2 country code, e.g. US')
    .action(async (code: string) => {
      await runAction({ stdout, stderr, exit }, async () => {
        const store = resolveStore(deps, program.optsWithGlobals<GlobalOptions>())
        await setCountry(store, code)
        return { ok: true, country: code.toUpperCase() }
      })
    })

  config
    .command('show')
    .description('Show stored CLI preferences')
    .action(async () => {
      await runAction({ stdout, stderr, exit }, async () => {
        const store = resolveStore(deps, program.optsWithGlobals<GlobalOptions>())
        return { country: (await store.get(COUNTRY_ACCOUNT)) ?? null }
      })
    })

  return program
}

export async function main(argv = process.argv, deps: CliDependencies = {}): Promise<void> {
  const stderr = deps.stderr ?? process.stderr
  const exit = deps.exit ?? ((code: number): never => process.exit(code))
  try {
    await createProgram(deps).parseAsync(argv)
  } catch (error) {
    // Action errors are already handled inside runAction/runCatalogAction; this
    // only catches option/argument parse errors thrown by the argParsers so they
    // print a clean message instead of an unhandled stack trace.
    stderr.write(`# Error\n\n${toErrorMessage(error)}\n`)
    exit(1)
  }
}

function resolveClient(deps: CliDependencies, program: Command): ShopCatalogClient {
  const globals = program.optsWithGlobals<GlobalOptions>()
  const store = resolveStore(deps, globals)
  // Only treat --country as an explicit override when it was actually passed on the CLI;
  // otherwise leave it undefined so the client falls back to the stored preference, then
  // DEFAULT_COUNTRY. The default value of the option must never override a stored country.
  const explicitCountry = program.getOptionValueSource('country') === 'cli' ? globals.country : undefined
  return new ShopCatalogClient({
    fetch: deps.fetch,
    store,
    profileUrl: globals.profileUrl,
    country: explicitCountry,
  })
}

let memoryStore: MemorySecretStore | undefined

function resolveStore(deps: CliDependencies, globals: GlobalOptions): SecretStore {
  if (deps.store) return deps.store
  if (globals.memoryStore) {
    memoryStore ??= new MemorySecretStore()
    return memoryStore
  }
  return new KeytarSecretStore()
}

async function runAction(
  io: Required<Pick<CliDependencies, 'exit'>> & Pick<CliDependencies, 'stdout' | 'stderr'>,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action()
    io.stdout?.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    io.stderr?.write(`# Error\n\n${toErrorMessage(error)}\n`)
    io.exit(1)
  }
}

// Checkout create/update: surface the UCP `messages[]` warnings (final_sale,
// prop65, age_restricted, disclosures) above the raw JSON so the agent reliably
// sees them and can show them to the user before completing. Full JSON is kept.
async function runCheckoutAction(
  io: Required<Pick<CliDependencies, 'exit'>> & Pick<CliDependencies, 'stdout' | 'stderr'>,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action()
    const messages = renderCheckoutMessages(result)
    if (messages) io.stdout?.write(`${messages}\n\n`)
    io.stdout?.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    io.stderr?.write(`# Error\n\n${toErrorMessage(error)}\n`)
    io.exit(1)
  }
}

// Orders return a markdown summary from the API; print it verbatim rather than
// wrapping it in JSON (which would escape the newlines into an unreadable blob).
async function runTextAction(
  io: Required<Pick<CliDependencies, 'exit'>> & Pick<CliDependencies, 'stdout' | 'stderr'>,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action()
    const text = typeof result === 'string' ? result : `${JSON.stringify(result, null, 2)}`
    io.stdout?.write(text.endsWith('\n') ? text : `${text}\n`)
  } catch (error) {
    io.stderr?.write(`# Error\n\n${toErrorMessage(error)}\n`)
    io.exit(1)
  }
}

// Catalog read commands default to compact markdown; --format json prints raw JSON.
async function runCatalogAction(
  io: Required<Pick<CliDependencies, 'exit'>> & Pick<CliDependencies, 'stdout' | 'stderr'>,
  toolName: string,
  program: Command,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await action()
    const format = program.optsWithGlobals<GlobalOptions>().format ?? 'md'
    if (format === 'json') {
      io.stdout?.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      io.stdout?.write(`${renderCatalogResult(toolName, result)}\n`)
    }
  } catch (error) {
    io.stderr?.write(`# Error\n\n${toErrorMessage(error)}\n`)
    io.exit(1)
  }
}

function parseFormat(value: string): OutputFormat {
  if (value === 'md' || value === 'json') return value
  throw new Error(`Invalid --format "${value}". Use "md" or "json".`)
}

function buildShipsTo(
  country?: string,
  region?: string,
  postal?: string,
): { country: string; region?: string; postalCode?: string } | undefined {
  if (!country) return undefined
  return { country, region, postalCode: postal }
}

// Strict integer parser with optional inclusive bounds. Rejects non-integers,
// trailing garbage (e.g. "12abc"), and out-of-range values instead of silently
// truncating or accepting them.
function parseBoundedInt(min: number, max?: number): (value: string) => number {
  return (value: string): number => {
    const trimmed = value.trim()
    if (!/^-?\d+$/.test(trimmed)) throw new Error(`Invalid integer: "${value}"`)
    const parsed = Number.parseInt(trimmed, 10)
    if (parsed < min || (max !== undefined && parsed > max)) {
      const range = max !== undefined ? `${min}-${max}` : `>= ${min}`
      throw new Error(`Value out of range (expected ${range}): ${value}`)
    }
    return parsed
  }
}

const parseLimit = parseBoundedInt(1, 50)
const parsePrice = parseBoundedInt(0)
const parseQuantity = parseBoundedInt(1)

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const IMAGE_EXT_CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

// Resolve the --image value to inline UCP image content.
// Accepts a path to an image file (read + base64-encoded here, so large images never have to be
// passed as a shell argument), or the legacy inline "<mime>:<base64>" form for small/programmatic use.
function resolveImage(image: string): { content_type: string; data: string } {
  const separator = image.indexOf(':')
  if (separator !== -1) {
    const prefix = image.slice(0, separator)
    if (/^[a-z]+\/[a-z0-9.+-]+$/i.test(prefix)) {
      return { content_type: prefix, data: image.slice(separator + 1) }
    }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(image)
  } catch {
    throw new Error(
      `--image must be a path to an image file or inline "<mime>:<base64>"; could not read "${image}"`,
    )
  }
  const ext = extname(image).toLowerCase()
  const contentType = IMAGE_EXT_CONTENT_TYPE[ext]
  if (!contentType) {
    throw new Error(
      `--image: unsupported image extension "${ext || '(none)'}". Supported: ${Object.keys(IMAGE_EXT_CONTENT_TYPE).join(', ')}`,
    )
  }
  return { content_type: contentType, data: buffer.toString('base64') }
}

function buildLike(ids?: string[], image?: string): unknown[] | undefined {
  const like: unknown[] = []
  for (const id of ids ?? []) like.push({ id })
  if (image) like.push({ image: resolveImage(image) })
  return like.length > 0 ? like : undefined
}

async function readJsonFromStdin(stdin: NodeJS.ReadStream | AsyncIterable<Buffer | string>): Promise<Record<string, unknown>> {
  const text = await readTextFromStdin(stdin)
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('stdin must contain a JSON object')
  }
  return parsed as Record<string, unknown>
}

// Pull the payment instruments out of whatever the caller piped in: either the
// full create_checkout response ({ payment: { instruments: [...] } }) or a bare
// payment block ({ instruments: [...] }). complete_checkout must echo these back
// so the merchant can match the instrument id it issued for this checkout.
function extractInstruments(checkout: Record<string, unknown>): Record<string, unknown>[] {
  const payment = isObject(checkout.payment) ? checkout.payment : checkout
  const instruments = isObject(payment) ? payment.instruments : undefined
  if (!Array.isArray(instruments) || instruments.length === 0) {
    throw new Error(
      'stdin must contain the create_checkout response with payment.instruments (pipe the create output, or a {"payment":{"instruments":[...]}} object).',
    )
  }
  return instruments.filter(isObject)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readTextFromStdin(stdin: NodeJS.ReadStream | AsyncIterable<Buffer | string>): Promise<string> {
  let text = ''
  for await (const chunk of stdin) text += chunk.toString()
  return text
}

function parseSelections(values?: string[]): Array<{ name: string; label: string }> | undefined {
  if (!values?.length) return undefined
  return values.map((value) => {
    const separator = value.indexOf('=')
    if (separator === -1) throw new Error('--select must be formatted as name=label')
    return {
      name: value.slice(0, separator),
      label: value.slice(separator + 1),
    }
  })
}

function parseOrderType(type: string): 'recent' | 'tracking' | 'order_info' | 'returns' | 'reorder' {
  if (['recent', 'tracking', 'order_info', 'returns', 'reorder'].includes(type)) {
    return type as 'recent' | 'tracking' | 'order_info' | 'returns' | 'reorder'
  }
  throw new Error(`Unsupported order type: ${type}`)
}
