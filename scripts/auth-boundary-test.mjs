import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const removedTools = ['google_health_revoke_access', 'google_health_exchange_code'];
const home = mkdtempSync(join(tmpdir(), 'google-health-auth-boundary-'));
const tokenPath = join(home, 'tokens.json');
const networkLog = join(home, 'network.log');
const guardPath = join(home, 'network-guard.mjs');
const tokens = JSON.stringify({ access_token: 'dummy-access', refresh_token: 'dummy-refresh', expires_at: Date.now() + 3600000 });
writeFileSync(tokenPath, tokens);
writeFileSync(networkLog, '');
// All application OAuth/API requests use fetch. Record even attempted calls and
// reject them before they reach the network; only the test client uses loopback.
writeFileSync(guardPath, `import { appendFileSync } from 'node:fs';
import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => process.stderr.write('AUTH_TEST_PORT=' + this.address().port + '\\n'));
  return listen.apply(this, args);
};
globalThis.fetch = async () => {
  appendFileSync(${JSON.stringify(networkLog)}, 'unexpected outbound fetch\\n');
  throw new Error('Outbound fetch forbidden in auth boundary test');
};\n`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('GOOGLE_HEALTH_') && key !== 'NODE_OPTIONS'));
Object.assign(env, {
  HOME: home, USERPROFILE: home,
  GOOGLE_HEALTH_CLIENT_ID: 'dummy-client',
  GOOGLE_HEALTH_CLIENT_SECRET: 'dummy-secret',
  GOOGLE_HEALTH_REDIRECT_URI: 'http://127.0.0.1:3000/callback',
  GOOGLE_HEALTH_TOKEN_PATH: tokenPath,
  GOOGLE_HEALTH_AUTO_REAUTH: 'false'
});
const args = ['--import', pathToFileURL(guardPath).href, 'dist/index.js'];
const httpToken = randomBytes(32).toString('base64url');

async function checkBoundary(client) {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 28);
  assert.ok(tools.some(({ name }) => name === 'google_health_get_auth_url'));
  const manifest = await client.callTool({ name: 'google_health_agent_manifest', arguments: { response_format: 'json' } });
  for (const removedTool of removedTools) {
    assert.ok(!tools.some(({ name }) => name === removedTool));
    assert.ok(!manifest.structuredContent.standard_tools.includes(removedTool));
    // Unknown tools must remain unreachable, even with a claimed confirmation.
    for (const arguments_ of [
      { code: 'untrusted', response_format: 'json' },
      { code: 'http://127.0.0.1:3000/callback?code=untrusted&state=forged', explicit_user_intent: true }
    ]) {
      let errorText;
      try {
        const result = await client.callTool({ name: removedTool, arguments: arguments_ });
        assert.equal(result.isError, true);
        errorText = JSON.stringify(result.content);
      } catch (error) {
        errorText = error.message;
      }
      assert.match(errorText, /not found|unknown tool/i);
      assert.ok(errorText.includes(removedTool));
    }
  }
  assert.equal(readFileSync(tokenPath, 'utf8'), tokens);
  assert.equal(readFileSync(networkLog, 'utf8'), '');
}

try {
  for (const host of ['127.0.0.1', '0.0.0.0']) {
    for (const token of ['', 'short', ' '.repeat(43)]) {
      const result = spawnSync(process.execPath, [...args, '--http'], {
        env: { ...env, GOOGLE_HEALTH_MCP_HOST: host, GOOGLE_HEALTH_MCP_PORT: '0', GOOGLE_HEALTH_MCP_AUTH_TOKEN: token },
        encoding: 'utf8', timeout: 10000
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /HTTP transport requires GOOGLE_HEALTH_MCP_AUTH_TOKEN/);
      assert.ok(!result.stderr.includes('AUTH_TEST_PORT='), 'Invalid auth config must never open a listener');
    }
  }
  const stdio = new Client({ name: 'auth-boundary-stdio', version: '0.0.0' });
  try {
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args, env }));
    await checkBoundary(stdio);
  } finally {
    await stdio.close();
  }

  // Port 0 lets the OS choose a free port, avoiding conflicts with other tests.
  const child = spawn(process.execPath, [...args, '--http'], {
    env: { ...env, GOOGLE_HEALTH_MCP_PORT: '0', GOOGLE_HEALTH_MCP_HOST: '127.0.0.1', GOOGLE_HEALTH_MCP_AUTH_TOKEN: httpToken },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const exited = once(child, 'exit');
  const httpClient = new Client({ name: 'auth-boundary-http', version: '0.0.0' });
  try {
    // Discover the actual bound port from the child without changing production logging.
    // A preload listens for the server's listening event (see below).
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP startup timed out')), 10000);
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        const match = stderr.match(/AUTH_TEST_PORT=(\d+)/);
        if (match) { clearTimeout(timer); resolve(new URL(`http://127.0.0.1:${match[1]}/mcp`)); }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`HTTP exited: ${stderr}`)); });
    });
    for (const authorization of [undefined, 'Bearer wrong', `Basic ${httpToken}`, `Bearer ${httpToken}extra`]) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
          // Malformed JSON proves authentication happens before body parsing.
          ...(method === 'POST' ? { body: '{' } : {})
        });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="google-health-mcp"');
        assert.deepEqual(await response.json(), { error: 'Unauthorized' });
      }
    }
    for (const method of ['tools/call', 'resources/read']) {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'google_health_exchange_code', arguments: { code: 'untrusted' } } })
      });
      assert.equal(response.status, 401);
      await response.text();
    }
    const forbidden = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${httpToken}`, Origin: 'https://untrusted.example' } });
    assert.equal(forbidden.status, 403);
    await forbidden.text();
    const preflight = await fetch(url, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(readFileSync(tokenPath, 'utf8'), tokens);
    assert.equal(readFileSync(networkLog, 'utf8'), '');
    await httpClient.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${httpToken}` } } }));
    await checkBoundary(httpClient);
  } finally {
    await httpClient.close();
    child.kill('SIGTERM');
    await exited;
  }
  console.log('Auth boundary passed: HTTP fails closed, rejects unauthenticated MCP access, and permits authenticated clients; revocation and code exchange remain unavailable on both transports.');
} finally {
  rmSync(home, { recursive: true, force: true });
}
