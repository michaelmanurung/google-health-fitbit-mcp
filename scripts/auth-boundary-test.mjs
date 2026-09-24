import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const removedTool = 'google_health_revoke_access';
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

async function checkBoundary(client) {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 28);
  assert.ok(!tools.some(({ name }) => name === removedTool));
  for (const name of ['google_health_get_auth_url', 'google_health_exchange_code']) {
    assert.ok(tools.some((tool) => tool.name === name), `${name} must remain available`);
  }
  const manifest = await client.callTool({ name: 'google_health_agent_manifest', arguments: { response_format: 'json' } });
  assert.ok(!manifest.structuredContent.standard_tools.includes(removedTool));
  // SDK versions may return a tool error or reject with a protocol error.
  let errorText;
  try {
    const result = await client.callTool({ name: removedTool, arguments: { response_format: 'json' } });
    assert.equal(result.isError, true);
    errorText = JSON.stringify(result.content);
  } catch (error) {
    errorText = error.message;
  }
  assert.match(errorText, /not found|unknown tool/i);
  assert.ok(errorText.includes(removedTool));
  assert.equal(readFileSync(tokenPath, 'utf8'), tokens);
  assert.equal(readFileSync(networkLog, 'utf8'), '');
}

try {
  const stdio = new Client({ name: 'auth-boundary-stdio', version: '0.0.0' });
  try {
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args, env }));
    await checkBoundary(stdio);
  } finally {
    await stdio.close();
  }

  // Port 0 lets the OS choose a free port, avoiding conflicts with other tests.
  const child = spawn(process.execPath, [...args, '--http'], {
    env: { ...env, GOOGLE_HEALTH_MCP_PORT: '0', GOOGLE_HEALTH_MCP_HOST: '127.0.0.1' },
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
    await httpClient.connect(new StreamableHTTPClientTransport(url));
    await checkBoundary(httpClient);
  } finally {
    await httpClient.close();
    child.kill('SIGTERM');
    await exited;
  }
  console.log('Auth boundary passed: stdio and HTTP reject revocation without credential changes or outbound fetches.');
} finally {
  rmSync(home, { recursive: true, force: true });
}
