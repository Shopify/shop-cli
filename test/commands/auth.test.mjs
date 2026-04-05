import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';

let nextTokens = { access_token: 'tok123', refresh_token: 'ref456', scope: 'openid email' };
let nextGetValidToken = { accessToken: 'tok123', userinfo: { email: 'user@example.com' } };
let nextRefresh = { access_token: 'new-tok' };
let nextValidateToken = { email: 'user@example.com' };
let nextDeviceAuth = {
  device_code: 'dev-123',
  user_code: 'ABCD-1234',
  verification_uri: 'https://accounts.shop.app/activate',
  expires_in: 600,
  interval: 5,
};
let nextPollResult = { access_token: 'device-tok', refresh_token: 'device-ref', scope: 'openid' };

const mockLoadTokens = mock.fn(() => nextTokens);
const mockSaveTokens = mock.fn(() => {});
const mockStampExpiry = mock.fn((tokens) => ({ ...tokens, expires_at: Date.now() + 86400000 }));
const mockGetValidToken = mock.fn(async () => nextGetValidToken);
const mockRefreshAccessToken = mock.fn(async () => nextRefresh);
const mockValidateToken = mock.fn(async () => nextValidateToken);
const mockRequestDeviceAuth = mock.fn(async () => nextDeviceAuth);
const mockPollForDeviceToken = mock.fn(async () => nextPollResult);

let fsExistsResult = true;
const mockExistsSync = mock.fn(() => fsExistsResult);
const mockUnlinkSync = mock.fn(() => {});

mock.module('node:fs', {
  namedExports: {
    existsSync: mockExistsSync,
    unlinkSync: mockUnlinkSync,
    readFileSync: (await import('node:fs')).readFileSync,
    writeFileSync: (await import('node:fs')).writeFileSync,
    mkdirSync: (await import('node:fs')).mkdirSync,
  },
});

mock.module('../../lib/auth.mjs', {
  namedExports: {
    loadTokens: mockLoadTokens,
    saveTokens: mockSaveTokens,
    stampExpiry: mockStampExpiry,
    getValidToken: mockGetValidToken,
    refreshAccessToken: mockRefreshAccessToken,
    validateToken: mockValidateToken,
    requestDeviceAuthorization: mockRequestDeviceAuth,
    pollForDeviceToken: mockPollForDeviceToken,
    TOKENS_FILE: '/fake/.shop/tokens.json',
  },
});

const { authCommand } = await import('../../lib/commands/auth.mjs');

function restoreMethodMocks() {
  console.log.mock?.restore();
  process.exit.mock?.restore();
}

// ── auth init ───────────────────────────────────────────────────────
describe('auth init', () => {
  let program;
  let logMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;
    nextDeviceAuth = {
      device_code: 'dev-123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://accounts.shop.app/activate',
      verification_uri_complete: 'https://accounts.shop.app/activate?user_code=ABCD-1234',
      expires_in: 600,
      interval: 5,
    };
    nextPollResult = { access_token: 'device-tok', refresh_token: 'device-ref', scope: 'openid' };
    nextValidateToken = { email: 'user@example.com' };

    mockRequestDeviceAuth.mock.resetCalls();
    mockRequestDeviceAuth.mock.mockImplementation(async () => nextDeviceAuth);
    mockPollForDeviceToken.mock.resetCalls();
    mockPollForDeviceToken.mock.mockImplementation(async () => nextPollResult);
    mockSaveTokens.mock.resetCalls();
    mockSaveTokens.mock.mockImplementation(() => {});
    mockValidateToken.mock.resetCalls();
    mockValidateToken.mock.mockImplementation(async () => nextValidateToken);

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    authCommand(program);

    logMock = mock.method(console, 'log', () => {});
    mock.method(process, 'exit', (code) => {
      exitCode = code;
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    restoreMethodMocks();
  });

  it('prints verification URI and code, polls, saves tokens, and prints email', async () => {
    await program.parseAsync(['node', 'shop', 'auth', 'init']);

    assert.equal(mockRequestDeviceAuth.mock.callCount(), 1);
    assert.equal(mockPollForDeviceToken.mock.callCount(), 1);
    assert.equal(mockSaveTokens.mock.callCount(), 2);
    assert.equal(mockStampExpiry.mock.callCount(), 1);
    const saved = mockSaveTokens.mock.calls[1].arguments[0];
    assert.equal(saved.access_token, nextPollResult.access_token);
    assert.ok(saved.expires_at, 'saved tokens should have expires_at');
    assert.deepEqual(saved.userinfo, nextValidateToken, 'second save should include userinfo');
    assert.equal(mockValidateToken.mock.callCount(), 1);

    const allOutput = logMock.mock.calls.map(c => c.arguments[0]).join('\n');
    assert.ok(allOutput.includes('https://accounts.shop.app/activate?user_code=ABCD-1234'));
    assert.ok(allOutput.includes('Waiting for approval'));
    assert.ok(allOutput.includes('Authenticated as user@example.com'));
  });

  it('exits 1 when requestDeviceAuthorization fails', async () => {
    mockRequestDeviceAuth.mock.mockImplementation(async () => {
      throw new Error('network down');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'shop', 'auth', 'init']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Could not start device authorization'),
    ));
  });

  it('exits 1 when pollForDeviceToken throws (expired)', async () => {
    mockPollForDeviceToken.mock.mockImplementation(async () => {
      throw new Error('Device code expired. Run "shop auth init" to try again.');
    });

    await assert.rejects(
      () => program.parseAsync(['node', 'shop', 'auth', 'init']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Device code expired'),
    ));
  });

  it('prints validation failed when validateToken returns null', async () => {
    mockValidateToken.mock.mockImplementation(async () => null);

    await program.parseAsync(['node', 'shop', 'auth', 'init']);

    assert.equal(mockSaveTokens.mock.callCount(), 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Tokens saved but could not validate'),
    ));
  });
});

// ── auth status ─────────────────────────────────────────────────────
describe('auth status', () => {
  let program;
  let logMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextTokens = { access_token: 'tok123', refresh_token: 'ref456', scope: 'openid email' };
    nextGetValidToken = { accessToken: 'tok123', userinfo: { email: 'user@example.com' } };

    mockLoadTokens.mock.resetCalls();
    mockLoadTokens.mock.mockImplementation(() => nextTokens);
    mockGetValidToken.mock.resetCalls();
    mockGetValidToken.mock.mockImplementation(async () => nextGetValidToken);

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    authCommand(program);

    logMock = mock.method(console, 'log', () => {});
    mock.method(process, 'exit', (code) => {
      exitCode = code;
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    restoreMethodMocks();
  });

  it('prints authenticated email and scopes', async () => {
    await program.parseAsync(['node', 'shop', 'auth', 'status']);

    assert.equal(mockLoadTokens.mock.callCount(), 1);
    assert.equal(mockGetValidToken.mock.callCount(), 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Authenticated as user@example.com'),
    ));
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Scopes: openid email'),
    ));
  });

  it('prints not authenticated and exits 1 when no tokens', async () => {
    nextTokens = null;
    mockLoadTokens.mock.mockImplementation(() => nextTokens);

    await assert.rejects(
      () => program.parseAsync(['node', 'shop', 'auth', 'status']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Not authenticated'),
    ));
  });
});

// ── auth refresh ────────────────────────────────────────────────────
describe('auth refresh', () => {
  let program;
  let logMock;
  let exitCode;

  beforeEach(() => {
    exitCode = undefined;

    nextTokens = { access_token: 'tok123', refresh_token: 'ref456', scope: 'openid email' };
    nextRefresh = { access_token: 'new-tok' };
    nextValidateToken = { email: 'user@example.com' };

    mockLoadTokens.mock.resetCalls();
    mockLoadTokens.mock.mockImplementation(() => nextTokens);
    mockSaveTokens.mock.resetCalls();
    mockSaveTokens.mock.mockImplementation(() => {});
    mockRefreshAccessToken.mock.resetCalls();
    mockRefreshAccessToken.mock.mockImplementation(async () => nextRefresh);
    mockValidateToken.mock.resetCalls();
    mockValidateToken.mock.mockImplementation(async () => nextValidateToken);

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    authCommand(program);

    logMock = mock.method(console, 'log', () => {});
    mock.method(process, 'exit', (code) => {
      exitCode = code;
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    restoreMethodMocks();
  });

  it('refreshes, saves, validates, and prints refreshed email', async () => {
    await program.parseAsync(['node', 'shop', 'auth', 'refresh']);

    assert.equal(mockRefreshAccessToken.mock.callCount(), 1);
    assert.equal(mockSaveTokens.mock.callCount(), 1);
    assert.equal(mockValidateToken.mock.callCount(), 1);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Token refreshed for user@example.com'),
    ));
  });

  it('exits 1 when no tokens', async () => {
    nextTokens = null;
    mockLoadTokens.mock.mockImplementation(() => nextTokens);

    await assert.rejects(
      () => program.parseAsync(['node', 'shop', 'auth', 'refresh']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
  });

  it('exits 1 when refresh fails', async () => {
    mockRefreshAccessToken.mock.mockImplementation(async () => null);

    await assert.rejects(
      () => program.parseAsync(['node', 'shop', 'auth', 'refresh']),
      { message: 'process.exit' },
    );

    assert.equal(exitCode, 1);
  });
});

// ── auth logout ────────────────────────────────────────────────────
describe('auth logout', () => {
  let program;
  let logMock;

  beforeEach(() => {
    fsExistsResult = true;
    mockExistsSync.mock.resetCalls();
    mockUnlinkSync.mock.resetCalls();

    program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    authCommand(program);

    logMock = mock.method(console, 'log', () => {});
  });

  afterEach(() => {
    restoreMethodMocks();
  });

  it('removes tokens file and prints confirmation', async () => {
    await program.parseAsync(['node', 'shop', 'auth', 'logout']);

    assert.equal(mockExistsSync.mock.callCount(), 1);
    assert.equal(mockUnlinkSync.mock.callCount(), 1);
    assert.equal(mockUnlinkSync.mock.calls[0].arguments[0], '/fake/.shop/tokens.json');
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Logged out'),
    ));
  });

  it('prints not logged in when no tokens file exists', async () => {
    fsExistsResult = false;
    mockExistsSync.mock.mockImplementation(() => false);

    await program.parseAsync(['node', 'shop', 'auth', 'logout']);

    assert.equal(mockUnlinkSync.mock.callCount(), 0);
    assert.ok(logMock.mock.calls.some(
      call => call.arguments[0].includes('Not logged in'),
    ));
  });
});
