import { randomBytes } from "node:crypto";
import type { GoogleHealthConfig } from "../types.js";
import { openBrowser, parseLocalRedirectUri, waitForOAuthCode } from "./oauth-loopback.js";

const DEFAULT_WAIT_MS = 45_000;
const DEFAULT_FLOW_TIMEOUT_MS = 300_000;

// Google revokes refresh tokens after 7 days while the OAuth consent screen is still in "Testing"
// publishing status, which surfaces as invalid_grant on the next refresh. The grant is gone, so no
// amount of retrying revives it — only a fresh authorization code does. This module reopens the
// loopback consent flow in place so the user just approves in the browser and the original tool
// call continues, instead of hitting an opaque HTTP 400.
export class GrantRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantRevokedError";
  }
}

export interface InteractiveAuthOptions {
  config: GoogleHealthConfig;
  buildAuthUrl: (state: string) => string;
  exchangeCode: (code: string) => Promise<void>;
  env?: Record<string, string | undefined>;
  argv?: string[];
}

export type ReauthOutcome =
  | { status: "completed" }
  | { status: "pending"; auth_url: string; browser_opened: boolean }
  | { status: "unavailable"; reason: string };

interface PendingFlow {
  promise: Promise<void>;
  authUrl: string;
  browserOpened: boolean;
}

// One flow at a time: parallel tool calls all fail with invalid_grant at once, and each would
// otherwise spawn its own browser tab and race for the same loopback port.
let pending: PendingFlow | null = null;

export function isAutoReauthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !isDisabled(env.GOOGLE_HEALTH_AUTO_REAUTH);
}

// Headless hosts have nothing to open; the loopback listener still runs so the URL can be visited
// from another machine, and tests use this to keep a real browser from appearing.
export function shouldOpenBrowser(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.GOOGLE_HEALTH_AUTH_NO_BROWSER?.trim().toLowerCase();
  return !value || ["0", "false", "off", "no"].includes(value);
}

function isDisabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  return ["0", "false", "off", "no"].includes(value);
}

// Only the stdio transport is guaranteed to be the user's own machine. Under the HTTP transport the
// server may be remote (opening a browser there helps nobody) and its default port collides with the
// loopback redirect URI.
export function isLocalStdioTransport(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2)
): boolean {
  const transport = env.GOOGLE_HEALTH_MCP_TRANSPORT ?? (argv.includes("--http") ? "http" : "stdio");
  return transport === "stdio";
}

export function checkInteractiveAuthAvailability(
  config: GoogleHealthConfig,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2)
): { ok: true } | { ok: false; reason: string } {
  if (!isAutoReauthEnabled(env)) return { ok: false, reason: "GOOGLE_HEALTH_AUTO_REAUTH is disabled" };
  if (!isLocalStdioTransport(env, argv)) return { ok: false, reason: "automatic re-authorization only runs on the local stdio transport" };
  try {
    parseLocalRedirectUri(config.redirectUri);
  } catch {
    return { ok: false, reason: "GOOGLE_HEALTH_REDIRECT_URI is not a local loopback URL" };
  }
  return { ok: true };
}

export async function ensureInteractiveReauth(options: InteractiveAuthOptions): Promise<ReauthOutcome> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const availability = checkInteractiveAuthAvailability(options.config, env, argv);
  if (!availability.ok) return { status: "unavailable", reason: availability.reason };

  const flow = pending ?? startFlow(options, env);
  const completed = await settleWithin(flow.promise, positiveNumber(env.GOOGLE_HEALTH_REAUTH_WAIT_MS, DEFAULT_WAIT_MS));
  return completed
    ? { status: "completed" }
    : { status: "pending", auth_url: flow.authUrl, browser_opened: flow.browserOpened };
}

function startFlow(options: InteractiveAuthOptions, env: Record<string, string | undefined>): PendingFlow {
  const redirect = parseLocalRedirectUri(options.config.redirectUri);
  const state = randomBytes(4).toString("hex");
  const authUrl = options.buildAuthUrl(state);
  const timeoutMs = positiveNumber(env.GOOGLE_HEALTH_AUTH_TIMEOUT_MS, DEFAULT_FLOW_TIMEOUT_MS);

  const openInBrowser = shouldOpenBrowser(env);
  const promise = (async () => {
    const result = await waitForOAuthCode(redirect, state, timeoutMs, () => {
      if (openInBrowser) openBrowser(authUrl);
    }, authUrl);
    await options.exchangeCode(result.code);
  })();

  const flow: PendingFlow = { promise, authUrl, browserOpened: openInBrowser };
  pending = flow;
  // The caller may stop awaiting at the bounded wait while the browser tab is still open, so keep a
  // terminal handler attached to avoid an unhandled rejection and to free the slot either way.
  void promise.catch(() => undefined).then(() => {
    if (pending === flow) pending = null;
  });
  return flow;
}

// Resolves true when the flow finished in time, false on timeout. Rejects if the flow itself failed.
async function settleWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resetInteractiveAuthStateForTests(): void {
  pending = null;
}
