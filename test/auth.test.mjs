import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("auth", () => {
  let auth;

  // We dynamically import after setting up mocks
  const fsMock = {
    existsSync: mock.fn(),
    readFileSync: mock.fn(),
    writeFileSync: mock.fn(),
    mkdirSync: mock.fn(),
  };

  beforeEach(async () => {
    fsMock.existsSync.mock.resetCalls();
    fsMock.readFileSync.mock.resetCalls();
    fsMock.writeFileSync.mock.resetCalls();
    fsMock.mkdirSync.mock.resetCalls();

    mock.module("node:fs", {
      namedExports: fsMock,
    });

    auth = await import("../lib/auth.mjs");
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ── ensureConfigDir ──────────────────────────────────────────────
  describe("ensureConfigDir", () => {
    it("creates dir when missing", () => {
      fsMock.existsSync.mock.mockImplementation(() => false);
      auth.ensureConfigDir();
      assert.equal(fsMock.mkdirSync.mock.callCount(), 1);
    });

    it("always calls mkdirSync with recursive", () => {
      auth.ensureConfigDir();
      assert.equal(fsMock.mkdirSync.mock.callCount(), 1);
    });
  });

  // ── loadTokens ──────────────────────────────────────────────────
  describe("loadTokens", () => {
    it("returns parsed JSON when file exists", () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(
        () => '{"access_token":"abc"}',
      );
      const tokens = auth.loadTokens();
      assert.deepEqual(tokens, { access_token: "abc" });
    });

    it("returns null when file missing", () => {
      fsMock.existsSync.mock.mockImplementation(() => false);
      assert.equal(auth.loadTokens(), null);
    });

    it("returns null on invalid JSON", () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() => "not-json");
      assert.equal(auth.loadTokens(), null);
    });
  });

  // ── saveTokens ──────────────────────────────────────────────────
  describe("saveTokens", () => {
    it("calls ensureConfigDir then writeFileSync", () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      auth.saveTokens({ access_token: "xyz" });
      assert.equal(fsMock.writeFileSync.mock.callCount(), 1);
      const [, content] = fsMock.writeFileSync.mock.calls[0].arguments;
      assert.deepEqual(JSON.parse(content), { access_token: "xyz" });
    });
  });

  // ── validateToken ───────────────────────────────────────────────
  describe("validateToken", () => {
    it("returns userinfo on 200", async () => {
      const userinfo = { email: "user@example.com" };
      mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => userinfo,
      }));
      const result = await auth.validateToken("good-token");
      assert.deepEqual(result, userinfo);
    });

    it("returns null on non-200", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 401,
      }));
      const result = await auth.validateToken("bad-token");
      assert.equal(result, null);
    });
  });

  // ── refreshAccessToken ──────────────────────────────────────────
  describe("refreshAccessToken", () => {
    it("returns new tokens on success", async () => {
      const fresh = { access_token: "new-token", refresh_token: "new-refresh" };
      mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => fresh,
      }));
      const result = await auth.refreshAccessToken({
        refresh_token: "old-refresh",
      });
      assert.deepEqual(result, fresh);
    });

    it("returns null when no refresh_token", async () => {
      const result = await auth.refreshAccessToken({});
      assert.equal(result, null);
    });

    it("returns null on failure", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 400,
      }));
      const result = await auth.refreshAccessToken({ refresh_token: "bad" });
      assert.equal(result, null);
    });
  });

  // ── requestDeviceAuthorization ─────────────────────────────────
  describe("requestDeviceAuthorization", () => {
    it("returns device auth response on success", async () => {
      const deviceResponse = {
        device_code: "dev-123",
        user_code: "ABCD-1234",
        verification_uri: "https://accounts.shop.app/activate",
        expires_in: 600,
        interval: 5,
      };
      mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => deviceResponse,
      }));

      const result = await auth.requestDeviceAuthorization();
      assert.deepEqual(result, deviceResponse);
    });

    it("sends correct client_id and scope", async () => {
      let capturedBody;
      mock.method(globalThis, "fetch", async (_url, opts) => {
        capturedBody = new URLSearchParams(opts.body);
        return {
          ok: true,
          json: async () => ({ device_code: "x", user_code: "Y" }),
        };
      });

      await auth.requestDeviceAuthorization();
      assert.equal(
        capturedBody.get("client_id"),
        "1617757b-9d58-44c5-bf90-31ccd8258891",
      );
      assert.equal(
        capturedBody.get("scope"),
        "agent:access email openid orders profile pay:wallet_tokens",
      );
    });

    it("throws on non-200", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 400,
        text: async () => "bad request",
      }));

      await assert.rejects(
        () => auth.requestDeviceAuthorization(),
        /Device authorization failed \(400\)/,
      );
    });
  });

  // ── pollForDeviceToken ────────────────────────────────────────
  describe("pollForDeviceToken", () => {
    beforeEach(() => {
      mock.method(globalThis, "setTimeout", (fn) => fn());
    });

    it("returns tokens on immediate success", async () => {
      const tokens = {
        access_token: "tok",
        refresh_token: "ref",
        scope: "openid",
      };
      mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => tokens,
      }));

      const result = await auth.pollForDeviceToken("dev-123", {
        interval: 0,
        expiresIn: 10,
      });
      assert.deepEqual(result, tokens);
    });

    it("polls through authorization_pending then succeeds", async () => {
      const tokens = { access_token: "tok", refresh_token: "ref" };
      let callCount = 0;
      mock.method(globalThis, "fetch", async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: "authorization_pending" }),
          };
        }
        return { ok: true, json: async () => tokens };
      });

      const result = await auth.pollForDeviceToken("dev-123", {
        interval: 0,
        expiresIn: 60,
      });
      assert.deepEqual(result, tokens);
      assert.equal(callCount, 3);
    });

    it("handles slow_down by increasing interval", async () => {
      const tokens = { access_token: "tok" };
      let callCount = 0;
      mock.method(globalThis, "fetch", async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: "slow_down" }),
          };
        }
        return { ok: true, json: async () => tokens };
      });

      const result = await auth.pollForDeviceToken("dev-123", {
        interval: 0,
        expiresIn: 60,
      });
      assert.deepEqual(result, tokens);
      assert.equal(callCount, 2);
    });

    it("throws on expired_token", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "expired_token" }),
      }));

      await assert.rejects(
        () =>
          auth.pollForDeviceToken("dev-123", { interval: 0, expiresIn: 60 }),
        /Device code expired/,
      );
    });

    it("throws on access_denied", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "access_denied" }),
      }));

      await assert.rejects(
        () =>
          auth.pollForDeviceToken("dev-123", { interval: 0, expiresIn: 60 }),
        /Authorization denied/,
      );
    });

    it("throws on timeout when expiresIn is 0", async () => {
      mock.method(globalThis, "fetch", async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "authorization_pending" }),
      }));

      await assert.rejects(
        () => auth.pollForDeviceToken("dev-123", { interval: 0, expiresIn: 0 }),
        /Device code expired/,
      );
    });
  });

  // ── stampExpiry ──────────────────────────────────────────────────
  describe("stampExpiry", () => {
    it("adds expires_at from expires_in", () => {
      const now = Date.now();
      const result = auth.stampExpiry({
        access_token: "tok",
        expires_in: 3600,
      });
      assert.ok(result.expires_at >= now + 3600 * 1000 - 100);
      assert.ok(result.expires_at <= now + 3600 * 1000 + 100);
    });

    it("defaults to 24h when expires_in is missing", () => {
      const now = Date.now();
      const result = auth.stampExpiry({ access_token: "tok" });
      const expected = now + 24 * 60 * 60 * 1000;
      assert.ok(result.expires_at >= expected - 100);
      assert.ok(result.expires_at <= expected + 100);
    });

    it("preserves all original fields", () => {
      const result = auth.stampExpiry({
        access_token: "tok",
        refresh_token: "ref",
        scope: "openid",
      });
      assert.equal(result.access_token, "tok");
      assert.equal(result.refresh_token, "ref");
      assert.equal(result.scope, "openid");
    });
  });

  // ── getValidToken ───────────────────────────────────────────────
  describe("getValidToken", () => {
    it("throws when no tokens saved", async () => {
      fsMock.existsSync.mock.mockImplementation(() => false);
      await assert.rejects(() => auth.getValidToken(), /Not authenticated/);
    });

    it("returns token when valid", async () => {
      const userinfo = { email: "user@example.com" };
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({ access_token: "valid" }),
      );
      mock.method(globalThis, "fetch", async () => ({
        ok: true,
        json: async () => userinfo,
      }));

      const result = await auth.getValidToken();
      assert.equal(result.accessToken, "valid");
      assert.deepEqual(result.userinfo, userinfo);
    });

    it("skips network validation when expires_at is in the future", async () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          access_token: "still-fresh",
          expires_at: Date.now() + 60 * 60 * 1000,
        }),
      );
      let fetchCalled = false;
      mock.method(globalThis, "fetch", async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({ email: "user@example.com" }) };
      });

      const result = await auth.getValidToken();
      assert.equal(result.accessToken, "still-fresh");
      assert.equal(fetchCalled, false);
    });

    it("returns cached userinfo when expires_at is in the future", async () => {
      const cachedUserinfo = { email: "cached@example.com" };
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          access_token: "still-fresh",
          expires_at: Date.now() + 60 * 60 * 1000,
          userinfo: cachedUserinfo,
        }),
      );
      let fetchCalled = false;
      mock.method(globalThis, "fetch", async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ email: "network@example.com" }),
        };
      });

      const result = await auth.getValidToken();
      assert.equal(result.accessToken, "still-fresh");
      assert.deepEqual(result.userinfo, cachedUserinfo);
      assert.equal(fetchCalled, false);
    });

    it("validates via network when expires_at is in the past", async () => {
      const userinfo = { email: "user@example.com" };
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          access_token: "stale",
          refresh_token: "ref",
          expires_at: Date.now() - 1000,
        }),
      );

      let fetchCallCount = 0;
      mock.method(globalThis, "fetch", async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) return { ok: false, status: 401 };
        if (fetchCallCount === 2)
          return {
            ok: true,
            json: async () => ({ access_token: "refreshed", expires_in: 3600 }),
          };
        return { ok: true, json: async () => userinfo };
      });

      const result = await auth.getValidToken();
      assert.equal(result.accessToken, "refreshed");
      assert.ok(fetchCallCount >= 2);
    });

    it("refreshes expired token", async () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({
          access_token: "expired",
          refresh_token: "refresh-123",
        }),
      );

      let fetchCallCount = 0;
      mock.method(globalThis, "fetch", async (url) => {
        fetchCallCount++;
        // First call: validateToken → expired
        if (fetchCallCount === 1) return { ok: false, status: 401 };
        // Second call: refreshAccessToken → new tokens
        if (fetchCallCount === 2)
          return {
            ok: true,
            json: async () => ({
              access_token: "fresh",
              refresh_token: "refresh-new",
            }),
          };
        // Third call: validateToken with fresh token → success
        return {
          ok: true,
          json: async () => ({ email: "user@example.com" }),
        };
      });

      const result = await auth.getValidToken();
      assert.equal(result.accessToken, "fresh");
      assert.equal(fsMock.writeFileSync.mock.callCount(), 1);
    });

    it("throws when refresh fails", async () => {
      fsMock.existsSync.mock.mockImplementation(() => true);
      fsMock.readFileSync.mock.mockImplementation(() =>
        JSON.stringify({ access_token: "expired", refresh_token: "bad" }),
      );

      let fetchCallCount = 0;
      mock.method(globalThis, "fetch", async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) return { ok: false, status: 401 };
        return { ok: false, status: 400 };
      });

      await assert.rejects(() => auth.getValidToken(), /Session expired/);
    });
  });
});
