import {
  loadTokens,
  saveTokens,
  stampExpiry,
  getValidToken,
  refreshAccessToken,
  validateToken,
  requestDeviceAuthorization,
  pollForDeviceToken,
} from '../auth.mjs';

async function authInit() {
  let device;
  try {
    device = await requestDeviceAuthorization();
  } catch (err) {
    console.log(`Could not start device authorization: ${err.message}`);
    process.exit(1);
  }

  const verifyUrl = device.verification_uri_complete;
  console.log(`To sign in, open this URL:\n\n  ${verifyUrl}\n\nWaiting for approval...`);

  let tokens;
  try {
    tokens = await pollForDeviceToken(device.device_code, {
      interval: device.interval || 5,
      expiresIn: device.expires_in || 600,
    });
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }

  const stamped = stampExpiry(tokens);
  saveTokens(stamped);

  const userinfo = await validateToken(tokens.access_token);
  if (userinfo) {
    saveTokens({ ...stamped, userinfo });
    console.log(`Authenticated as ${userinfo.email}`);
  } else {
    console.log('Tokens saved but could not validate.');
  }
}

async function authStatus() {
  const tokens = loadTokens();
  if (!tokens) {
    console.log('Not authenticated. Run: shop auth init');
    process.exit(1);
  }

  try {
    const { userinfo } = await getValidToken();
    console.log(`Authenticated as ${userinfo.email}`);
    console.log(`Scopes: ${tokens.scope || 'unknown'}`);
  } catch (err) {
    console.log(`Auth error: ${err.message}`);
    process.exit(1);
  }
}

async function authRefresh() {
  const tokens = loadTokens();
  if (!tokens) {
    console.log('Not authenticated. Run: shop auth init');
    process.exit(1);
  }

  const fresh = await refreshAccessToken(tokens);
  if (!fresh) {
    console.log('Refresh failed. Run: shop auth init');
    process.exit(1);
  }

  const updated = { ...tokens, ...stampExpiry(fresh) };

  const userinfo = await validateToken(updated.access_token);
  if (userinfo) {
    saveTokens({ ...updated, userinfo });
    console.log(`Token refreshed for ${userinfo.email}`);
  } else {
    saveTokens(updated);
    console.log('Token refreshed but validation failed.');
  }
}

async function authSave(opts) {
  let raw;

  if (opts.file) {
    const { readFileSync } = await import('node:fs');
    try {
      raw = readFileSync(opts.file, 'utf-8').trim();
    } catch (err) {
      console.log(`Could not read file: ${opts.file}`);
      console.log(err.message);
      process.exit(1);
    }
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString().trim();
  }

  if (!raw) {
    console.log('No input received. Use --file <path> or pipe token JSON to stdin.');
    console.log('Example: shop auth save --file ~/Downloads/tokens.json');
    process.exit(1);
  }

  let tokens;
  try {
    tokens = JSON.parse(raw);
  } catch {
    console.log('Invalid JSON. Pipe a valid token JSON object to stdin.');
    process.exit(1);
  }

  if (!tokens.access_token) {
    console.log('Token JSON must contain an "access_token" field.');
    process.exit(1);
  }

  saveTokens(tokens);
  console.log('Tokens saved.');

  try {
    const { userinfo } = await getValidToken();
    console.log(`Authenticated as ${userinfo.email}`);
  } catch {
    console.log('Tokens saved but could not validate. You may need to refresh.');
  }
}

export function authCommand(program) {
  const auth = program
    .command('auth')
    .description('Authenticate with Shop');

  auth
    .command('status')
    .description('Check authentication status')
    .action(authStatus);

  auth
    .command('init')
    .description('Start device authorization flow')
    .action(authInit);

  auth
    .command('refresh')
    .description('Force token refresh')
    .action(authRefresh);

  auth
    .command('save')
    .description('Save token JSON from file or stdin')
    .option('--file <path>', 'Read tokens from file instead of stdin')
    .action(authSave);
}
