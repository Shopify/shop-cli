export const CLIENT_ID = '5c733ab2-1903-400a-891e-7ba20c09e2a3'
export const DEFAULT_AGENT_NAME = 'Shop CLI'
export const DEFAULT_COUNTRY = 'US'
export const DEFAULT_PROFILE_URL =
  'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json'
export const GLOBAL_CATALOG_MCP_URL = 'https://catalog.shopify.com/api/ucp/mcp'
export const CLI_VERSION = '0.1.0'
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
export const AUTH_SCOPES = 'openid email personal_agent pay:wallet_tokens:read'
export const UCP_PROFILE =
  'https://shopify.dev/ucp/agent-profiles/2026-04-08/personal_agent.json'
