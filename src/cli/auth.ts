import { randomBytes } from "node:crypto";
import { getConfig } from "../services/config.js";
import { GoogleHealthClient } from "../services/google-health-client.js";
import { openBrowser, parseLocalRedirectUri, waitForOAuthCode } from "../services/oauth-loopback.js";

export { buildBrowserOpenCommand, parseLocalRedirectUri } from "../services/oauth-loopback.js";
export type { BrowserOpenCommand, LocalRedirectPlan } from "../services/oauth-loopback.js";

export async function runAuthCommand(args: string[]): Promise<number> {
  const noOpen = args.includes("--no-open");
  const json = args.includes("--json");
  const config = getConfig();
  const redirect = parseLocalRedirectUri(config.redirectUri);
  const state = randomBytes(4).toString("hex");
  const client = new GoogleHealthClient(config);
  const authUrl = client.authUrl(state);
  const timeoutMs = Number(process.env.GOOGLE_HEALTH_AUTH_TIMEOUT_MS ?? 300_000);

  const result = await waitForOAuthCode(redirect, state, timeoutMs, async (url) => {
    if (!json) {
      console.log("Google Health MCP · Authorization");
      console.log("");
      if (noOpen) {
        console.log("Open this URL manually:");
        console.log(`  ${url}`);
      } else {
        console.log("Opening Google Health authorization in your browser...");
      }
      console.log("");
      console.log("Steps");
      console.log("  1. Approve access in the browser tab that opens.");
      console.log("  2. Google Health will redirect to the local callback.");
      console.log("  3. Tokens are saved locally; this command never prints them.");
      console.log("");
      console.log("Waiting for callback...");
    }
    if (!noOpen) openBrowser(url);
  }, authUrl);

  const exchange = await client.exchangeCode(result.code);
  const output = {
    ok: true,
    token_path: exchange.token_path,
    expires_at: exchange.expires_at,
    scope: exchange.scope,
    next_step: "Run `google-health-fitbit-mcp-server checkup`, then add the MCP server to your agent."
  };
  if (json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("");
    console.log("✓ Google Health connected");
    console.log("");
    console.log(`  Token file:  ${output.token_path}`);
    if (output.scope) console.log(`  Scope:       ${output.scope}`);
    if (output.expires_at) console.log(`  Expires at:  ${output.expires_at}`);
    console.log("");
    console.log(`→ Next: ${output.next_step}`);
  }
  return 0;
}
