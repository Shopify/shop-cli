import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".shop");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");
const USERINFO_URL = "https://server.shop.app/oauth/userinfo";
const TOKEN_URL = "https://accounts.shop.app/oauth/token";
const DEVICE_AUTH_URL = "https://accounts.shop.app/oauth/device";
const CLIENT_ID = "1617757b-9d58-44c5-bf90-31ccd8258891";
const SCOPE = "agent:access email openid orders profile pay:wallet_tokens";

const DEFAULT_EXPIRES_IN = 24 * 60 * 60; // 24 hours

export { CONFIG_DIR, TOKENS_FILE, USERINFO_URL, TOKEN_URL, DEVICE_AUTH_URL };

export function stampExpiry(tokens) {
  const expiresIn = tokens.expires_in || DEFAULT_EXPIRES_IN;
  return { ...tokens, expires_at: Date.now() + expiresIn * 1000 };
}

export function ensureConfigDir() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function loadTokens() {
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  ensureConfigDir();
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function validateToken(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function refreshAccessToken(tokens) {
  if (!tokens.refresh_token) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) return null;
  return res.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestDeviceAuthorization() {
  const res = await fetch(DEVICE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Device authorization failed (${res.status}): ${body}`);
  }

  return res.json();
}

export async function pollForDeviceToken(
  deviceCode,
  { interval = 5, expiresIn = 600 } = {},
) {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval;

  while (Date.now() < deadline) {
    await delay(pollInterval * 1000);

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: CLIENT_ID,
      }),
    });

    if (res.ok) return res.json();

    const body = await res.json().catch(() => ({}));

    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      pollInterval += 5;
      continue;
    }
    if (body.error === "expired_token") {
      throw new Error(
        'Device code expired. Run "shop auth init" to try again.',
      );
    }
    if (body.error === "access_denied") {
      throw new Error(
        'Authorization denied. Run "shop auth init" to try again.',
      );
    }

    throw new Error(`Device authorization error: ${body.error || res.status}`);
  }

  throw new Error('Device code expired. Run "shop auth init" to try again.');
}

/**
 * Get a valid access token — refreshing if needed.
 * Returns { accessToken, userinfo } or throws.
 */
export async function getValidToken() {
  const tokens = loadTokens();
  if (!tokens?.access_token) {
    throw new Error(
      'Not authenticated. Run "shop auth init" to get a sign-in link, or pipe tokens via "shop auth save".',
    );
  }

  // Skip network call if token hasn't expired yet
  if (tokens.expires_at && tokens.expires_at > Date.now()) {
    return {
      accessToken: tokens.access_token,
      userinfo: tokens.userinfo || null,
    };
  }

  // Try existing token
  let userinfo = await validateToken(tokens.access_token);
  if (userinfo) {
    return { accessToken: tokens.access_token, userinfo };
  }

  // Token expired — try refresh
  const fresh = await refreshAccessToken(tokens);
  if (!fresh) {
    throw new Error(
      'Session expired and refresh failed. Run "shop auth init" to re-authenticate.',
    );
  }

  const updated = { ...tokens, ...stampExpiry(fresh) };

  userinfo = await validateToken(updated.access_token);
  if (!userinfo) {
    saveTokens(updated);
    throw new Error(
      "Refresh succeeded but token still invalid. Run: shop auth init",
    );
  }

  saveTokens({ ...updated, userinfo });
  return { accessToken: updated.access_token, userinfo };
}
