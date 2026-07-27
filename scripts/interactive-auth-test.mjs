import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  checkInteractiveAuthAvailability,
  ensureInteractiveReauth,
  isAutoReauthEnabled,
  isLocalStdioTransport,
  resetInteractiveAuthStateForTests,
  shouldOpenBrowser
} from '../dist/services/interactive-auth.js';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function configFor(port) {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: `http://127.0.0.1:${port}/callback`,
    scopes: ['https://www.googleapis.com/auth/googlehealth.profile.readonly'],
    tokenPath: '/tmp/does-not-matter.json',
    privacyMode: 'structured',
    cacheEnabled: false,
    cachePath: '/tmp/does-not-matter.sqlite',
    apiBaseUrl: 'https://health.googleapis.com'
  };
}

// Never let this suite spawn a real browser tab.
const NO_BROWSER = { GOOGLE_HEALTH_AUTH_NO_BROWSER: '1' };

assert.equal(isAutoReauthEnabled({}), true);
assert.equal(isAutoReauthEnabled({ GOOGLE_HEALTH_AUTO_REAUTH: '0' }), false);
assert.equal(isAutoReauthEnabled({ GOOGLE_HEALTH_AUTO_REAUTH: 'false' }), false);
assert.equal(isAutoReauthEnabled({ GOOGLE_HEALTH_AUTO_REAUTH: 'OFF' }), false);
assert.equal(isAutoReauthEnabled({ GOOGLE_HEALTH_AUTO_REAUTH: '1' }), true);

assert.equal(shouldOpenBrowser({}), true);
assert.equal(shouldOpenBrowser({ GOOGLE_HEALTH_AUTH_NO_BROWSER: '1' }), false);

// The HTTP transport may be serving a remote client, and its default port collides with the
// loopback redirect, so the browser flow must stay off there.
assert.equal(isLocalStdioTransport({}, []), true);
assert.equal(isLocalStdioTransport({ GOOGLE_HEALTH_MCP_TRANSPORT: 'http' }, []), false);
assert.equal(isLocalStdioTransport({}, ['--http']), false);

const port = await freePort();
const config = configFor(port);

assert.deepEqual(checkInteractiveAuthAvailability(config, {}, []), { ok: true });
assert.equal(checkInteractiveAuthAvailability(config, { GOOGLE_HEALTH_AUTO_REAUTH: '0' }, []).ok, false);
assert.equal(checkInteractiveAuthAvailability(config, { GOOGLE_HEALTH_MCP_TRANSPORT: 'http' }, []).ok, false);
assert.match(
  checkInteractiveAuthAvailability({ ...config, redirectUri: 'https://example.com/callback' }, {}, []).reason,
  /loopback/i
);

// buildAuthUrl runs before the loopback listener is bound (the real flow opens the browser from the
// listen callback), so the stand-in for Google's redirect has to retry until the port answers.
async function hitCallback(state) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}/callback?code=test-code&state=${state}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('loopback listener never came up');
}

// Happy path: the flow hands the generated state to buildAuthUrl, so the test can play the part of
// Google redirecting back to the loopback listener.
resetInteractiveAuthStateForTests();
let exchanged = null;
let authUrlCalls = 0;
let capturedState = null;
const completed = ensureInteractiveReauth({
  config,
  env: NO_BROWSER,
  argv: [],
  buildAuthUrl: (state) => {
    authUrlCalls += 1;
    capturedState = state;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  },
  exchangeCode: async (code) => {
    exchanged = code;
  }
});
assert.ok(capturedState, 'buildAuthUrl should run synchronously');
assert.equal((await hitCallback(capturedState)).status, 200);
assert.deepEqual(await completed, { status: 'completed' });
assert.equal(exchanged, 'test-code');
assert.equal(authUrlCalls, 1);

// Nothing arrives before the bounded wait elapses: the caller gets an actionable URL while the
// listener stays up for the rest of the flow timeout.
resetInteractiveAuthStateForTests();
const pending = await ensureInteractiveReauth({
  config,
  env: { ...NO_BROWSER, GOOGLE_HEALTH_REAUTH_WAIT_MS: '50', GOOGLE_HEALTH_AUTH_TIMEOUT_MS: '400' },
  argv: [],
  buildAuthUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  exchangeCode: async () => assert.fail('exchangeCode must not run without a callback')
});
assert.equal(pending.status, 'pending');
assert.match(pending.auth_url, /accounts\.google\.com/);
// The message shown to the user must not claim a browser opened when it was suppressed.
assert.equal(pending.browser_opened, false);
await new Promise((resolve) => setTimeout(resolve, 600));

// Concurrent tool calls all fail with invalid_grant at once; only one consent flow may start,
// otherwise they race for the same loopback port.
resetInteractiveAuthStateForTests();
let concurrentAuthUrlCalls = 0;
const options = {
  config,
  env: { ...NO_BROWSER, GOOGLE_HEALTH_REAUTH_WAIT_MS: '50', GOOGLE_HEALTH_AUTH_TIMEOUT_MS: '400' },
  argv: [],
  buildAuthUrl: (state) => {
    concurrentAuthUrlCalls += 1;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  },
  exchangeCode: async () => assert.fail('exchangeCode must not run without a callback')
};
const outcomes = await Promise.all([
  ensureInteractiveReauth(options),
  ensureInteractiveReauth(options),
  ensureInteractiveReauth(options)
]);
assert.equal(concurrentAuthUrlCalls, 1);
for (const outcome of outcomes) assert.equal(outcome.status, 'pending');
await new Promise((resolve) => setTimeout(resolve, 600));

resetInteractiveAuthStateForTests();
console.log(JSON.stringify({ ok: true, interactive_auth: true, guards: true, single_flight: true }, null, 2));
