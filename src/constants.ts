import { createRequire } from 'node:module'

function readPackageVersion(): string {
  const packageJson = createRequire(import.meta.url)('../package.json') as { version?: unknown }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json is missing a valid "version" field')
  }
  return packageJson.version
}

export const CLIENT_ID = '5c733ab2-1903-400a-891e-7ba20c09e2a3'
export const DEFAULT_AGENT_NAME = 'Shop CLI'
export const DEFAULT_COUNTRY = 'US'
// UCP release the CLI speaks. Both agent profiles below are pinned to it, so
// bump this one constant when moving to a newer release.
export const UCP_VERSION = '2026-08-25'
export const AGENT_PROFILES_BASE_URL = `https://shopify.dev/ucp/agent-profiles/${UCP_VERSION}`
// Profile sent with global catalog calls (search/lookup/get_product).
export const DEFAULT_PROFILE_URL = `${AGENT_PROFILES_BASE_URL}/valid-with-capabilities.json`
export const GLOBAL_CATALOG_MCP_URL = 'https://catalog.shopify.com/api/ucp/mcp'
// Changesets updates package.json, so use it as the single source of truth.
export const CLI_VERSION = readPackageVersion()
export const USER_AGENT = `shop-cli/${CLI_VERSION}`
// Authenticated global-catalog access uses a brokered RFC 8693 token exchange:
// audience=api.shopify.com + requested_token_type=...access_token returns a
// Global API token that catalog.shopify.com accepts as a Bearer. (Distinct from
// the per-merchant checkout exchange, which targets resource=https://{shop}/.)
export const GLOBAL_CATALOG_AUDIENCE = 'api.shopify.com'
export const ACCESS_TOKEN_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
export const TOKEN_EXCHANGE_URL = 'https://shop.app/oauth/token'
export const PAYMENT_TOKENS_URL = 'https://shop.app/pay/agents/payment_tokens'
export const SHOP_AGENT_SERVICE = 'shop-agent'
export const ACCESS_TOKEN_ACCOUNT = 'access_token'
export const REFRESH_TOKEN_ACCOUNT = 'refresh_token'
export const DEVICE_ID_ACCOUNT = 'device_id'
export const COUNTRY_ACCOUNT = 'country'
// Short-lived device-authorization state persisted between `auth device-code`
// (emits the sign-in URL) and `auth poll` (exchanges + stores tokens).
export const PENDING_DEVICE_AUTH_ACCOUNT = 'pending_device_auth'
export const AUTH_SCOPES = 'openid email personal_agent'
// Profile sent with merchant checkout calls (create/update/complete_checkout).
export const UCP_PROFILE = `${AGENT_PROFILES_BASE_URL}/personal_agent.json`
