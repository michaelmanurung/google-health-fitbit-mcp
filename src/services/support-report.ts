import { constants as fsConstants, promises as fs } from "node:fs";
import { platform, arch } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOPES, NPM_PACKAGE_NAME, SERVER_VERSION } from "../constants.js";
import type { PrivacyMode } from "../types.js";
import type { AgentClientName } from "./agent-manifest.js";
import { getLocalConfigPath } from "./local-config.js";

type ConfigSource = "env" | "local_config" | "mixed" | "missing";
type ScopeStatus = "ok" | "missing_recommended" | "unknown" | "missing_token";

const REQUIRED_ENV = ["GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET", "GOOGLE_HEALTH_REDIRECT_URI"] as const;

export interface SupportReportOptions {
  homeDir: string;
  client?: AgentClientName;
}

export interface SupportReport {
  redacted: true;
  package: {
    name: string;
    version: string;
  };
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
  };
  config: {
    source: ConfigSource;
    required_env: Record<string, boolean>;
    missing_env: string[];
    redirect_uri: string | undefined;
    automatic_auth_supported: boolean;
    privacy_mode: PrivacyMode;
    cache_enabled: boolean;
  };
  token: {
    exists: boolean;
    readable: boolean;
    secure_permissions?: boolean;
    expired?: boolean;
    has_refresh_token?: boolean;
    scope_status: ScopeStatus;
    granted_scope_count: number;
    missing_recommended_scope_count: number;
  };
  next_steps: string[];
  issue_body: string;
}

export interface SetupFeedbackReport {
  kind: "google_health_setup_feedback";
  schema_version: 1;
  anonymous: true;
  redacted: true;
  package: SupportReport["package"];
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    node_major: number;
  };
  setup_state: {
    config_source: ConfigSource;
    env_present: Record<string, boolean>;
    missing_env: string[];
    local_callback_supported: boolean;
    privacy_mode: PrivacyMode;
    cache_enabled: boolean;
  };
  auth_state: {
    token_present: boolean;
    token_readable: boolean;
    token_secure_permissions?: boolean;
    token_expired?: boolean;
    refresh_token_present?: boolean;
    scope_status: ScopeStatus;
    granted_scope_count: number;
    missing_recommended_scope_count: number;
    activity_tools_ready: boolean;
    profile_tools_ready: boolean;
    nutrition_write_ready: boolean;
  };
  client_state?: {
    client: AgentClientName;
    configured?: boolean;
    package_pinned?: boolean;
    skill_installed?: boolean;
    reload_hint?: string;
  };
  friction_markers: string[];
  reviewer_questions: string[];
  issue_body: string;
}

type PublicFileStatus = {
  exists: boolean;
  readable: boolean;
  secure_permissions?: boolean;
};

type PublicSetupStatus = {
  required_env: Record<string, boolean>;
  missing_env: string[];
  redirect_uri?: string;
  automatic_auth_supported: boolean;
  privacy_mode: PrivacyMode;
  cache_enabled: boolean;
  config: {
    source: ConfigSource;
    exists: boolean;
  };
  token: PublicFileStatus & {
    expired?: boolean;
    has_refresh_token?: boolean;
  };
  oauth: {
    granted_scopes: string[];
    missing_recommended_scopes: string[];
    scope_status: ScopeStatus;
    activity_tools_ready: boolean;
    profile_tools_ready: boolean;
    nutrition_write_ready: boolean;
  };
  friction_markers: string[];
  next_steps: string[];
};

export async function buildSupportReport(options: SupportReportOptions): Promise<SupportReport> {
  const status = await buildPublicSetupStatus(options);
  const report: Omit<SupportReport, "issue_body"> = {
    redacted: true,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION
    },
    runtime: {
      platform: platform() as NodeJS.Platform,
      arch: arch(),
      node: process.versions.node
    },
    config: {
      source: status.config.source,
      required_env: status.required_env,
      missing_env: status.missing_env,
      redirect_uri: redactRedirectUri(status.redirect_uri),
      automatic_auth_supported: status.automatic_auth_supported,
      privacy_mode: status.privacy_mode,
      cache_enabled: status.cache_enabled
    },
    token: {
      exists: status.token.exists,
      readable: status.token.readable,
      secure_permissions: status.token.secure_permissions,
      expired: status.token.expired,
      has_refresh_token: status.token.has_refresh_token,
      scope_status: status.oauth.scope_status,
      granted_scope_count: status.oauth.granted_scopes.length,
      missing_recommended_scope_count: status.oauth.missing_recommended_scopes.length
    },
    next_steps: status.next_steps
  };
  return {
    ...report,
    issue_body: supportIssueBody(report)
  };
}

export async function buildSetupFeedbackReport(options: SupportReportOptions): Promise<SetupFeedbackReport> {
  const status = await buildPublicSetupStatus(options);
  const report: Omit<SetupFeedbackReport, "issue_body"> = {
    kind: "google_health_setup_feedback",
    schema_version: 1,
    anonymous: true,
    redacted: true,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION
    },
    runtime: {
      platform: platform() as NodeJS.Platform,
      arch: arch(),
      node_major: Number(process.versions.node.split(".")[0] ?? 0)
    },
    setup_state: {
      config_source: status.config.source,
      env_present: status.required_env,
      missing_env: status.missing_env,
      local_callback_supported: status.automatic_auth_supported,
      privacy_mode: status.privacy_mode,
      cache_enabled: status.cache_enabled
    },
    auth_state: {
      token_present: status.token.exists,
      token_readable: status.token.readable,
      token_secure_permissions: status.token.secure_permissions,
      token_expired: status.token.expired,
      refresh_token_present: status.token.has_refresh_token,
      scope_status: status.oauth.scope_status,
      granted_scope_count: status.oauth.granted_scopes.length,
      missing_recommended_scope_count: status.oauth.missing_recommended_scopes.length,
      activity_tools_ready: status.oauth.activity_tools_ready,
      profile_tools_ready: status.oauth.profile_tools_ready,
      nutrition_write_ready: status.oauth.nutrition_write_ready
    },
    client_state: options.client ? {
      client: options.client,
      configured: undefined,
      package_pinned: undefined,
      skill_installed: undefined,
      reload_hint: options.client === "hermes" ? "Use /reload-mcp or hermes mcp test google_health after config changes." : undefined
    } : undefined,
    friction_markers: status.friction_markers,
    reviewer_questions: [
      "Which MCP client did you test: Claude Desktop, Cursor, Codex, Hermes, OpenClaw, Windsurf or another client?",
      "Which step was unclear: Google Cloud OAuth client, redirect URI, setup, auth, checkup, client reload or tool choice?",
      "Did `checkup`, `checkup --live` or this feedback bundle give enough next-step guidance without exposing secrets?",
      "Did the default structured privacy mode feel safe for your agent workflow?",
      "Which source family are you validating: Fitbit, Pixel Watch, Android, Google sources or another supported source?"
    ]
  };
  return {
    ...report,
    issue_body: setupFeedbackIssueBody(report)
  };
}

export function formatSupportReport(report: SupportReport): string {
  return report.issue_body;
}

export function formatSetupFeedbackReport(report: SetupFeedbackReport): string {
  return report.issue_body;
}

async function buildPublicSetupStatus(options: SupportReportOptions): Promise<PublicSetupStatus> {
  const env = process.env;
  const requiredEnv = Object.fromEntries(REQUIRED_ENV.map((name) => [name, Boolean(env[name]?.trim())]));
  const localConfig = await inspectPublicFile(getLocalConfigPath(options.homeDir));
  const envUsed = Object.values(requiredEnv).some(Boolean);
  const configSource: ConfigSource = envUsed && localConfig.exists ? "mixed" : envUsed ? "env" : localConfig.exists ? "local_config" : "missing";
  const missingEnv = localConfig.exists ? [] : REQUIRED_ENV.filter((name) => !requiredEnv[name]);
  const redirectUri = env.GOOGLE_HEALTH_REDIRECT_URI?.trim() || undefined;
  const tokenPath = env.GOOGLE_HEALTH_TOKEN_PATH?.trim() || join(options.homeDir, ".google-health-mcp", "tokens.json");
  const token = await inspectPublicFile(tokenPath);
  const oauth = token.exists && token.readable
    ? {
        granted_scopes: [],
        missing_recommended_scopes: [],
        scope_status: "unknown" as const,
        activity_tools_ready: false,
        profile_tools_ready: false,
        nutrition_write_ready: false
      }
    : {
        granted_scopes: [],
        missing_recommended_scopes: DEFAULT_SCOPES,
        scope_status: "missing_token" as const,
        activity_tools_ready: false,
        profile_tools_ready: false,
        nutrition_write_ready: false
      };
  const status = {
    required_env: requiredEnv,
    missing_env: missingEnv,
    redirect_uri: redirectUri,
    automatic_auth_supported: Boolean(redirectUri && isLocalHttpRedirect(redirectUri)),
    privacy_mode: parsePrivacyMode(env.GOOGLE_HEALTH_PRIVACY_MODE),
    cache_enabled: parseBool(env.GOOGLE_HEALTH_CACHE),
    config: {
      source: configSource,
      exists: localConfig.exists
    },
    token,
    oauth
  };
  return {
    ...status,
    friction_markers: buildPublicFrictionMarkers(status, options.client),
    next_steps: buildPublicNextSteps(status)
  };
}

async function inspectPublicFile(path: string): Promise<PublicFileStatus> {
  try {
    const stat = await fs.stat(path);
    const securePermissions = process.platform === "win32" ? true : (stat.mode & 0o077) === 0;
    try {
      await fs.access(path, fsConstants.R_OK);
      return { exists: true, readable: true, secure_permissions: securePermissions };
    } catch {
      return { exists: true, readable: false, secure_permissions: securePermissions };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, readable: false };
    return { exists: true, readable: false };
  }
}

function buildPublicFrictionMarkers(status: Omit<PublicSetupStatus, "friction_markers" | "next_steps">, client?: AgentClientName): string[] {
  const markers: string[] = [];
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  if (!nodeSupported) markers.push("node_version_unsupported");
  if (status.config.source === "missing") markers.push("missing_oauth_config");
  if (status.redirect_uri && !status.automatic_auth_supported) markers.push("local_callback_not_ready");
  if (!status.token.exists) markers.push("token_missing");
  if (status.token.exists && !status.token.readable) markers.push("token_unreadable");
  if (status.token.secure_permissions === false) markers.push("token_permissions_insecure");
  if (status.oauth.scope_status === "unknown") markers.push("scope_not_read_by_public_report");
  if (client === "hermes") markers.push("hermes_details_not_read_by_public_report");
  if (!markers.length) markers.push("ready_for_beta_validation");
  return markers;
}

function buildPublicNextSteps(status: Omit<PublicSetupStatus, "friction_markers" | "next_steps">): string[] {
  const steps: string[] = [];
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  if (!nodeSupported) steps.push("Install Node.js 20 or newer.");
  if (status.config.source === "missing") steps.push("Run `google-health-fitbit-mcp-server setup` or set the required GOOGLE_HEALTH_* OAuth environment variables.");
  if (status.redirect_uri && !status.automatic_auth_supported) steps.push("For one-command auth, use a local callback such as http://127.0.0.1:3000/callback.");
  if (!status.token.exists) steps.push("Run `google-health-fitbit-mcp-server auth` to authorize Google Health and save local tokens.");
  if (status.token.exists && !status.token.readable) steps.push("Fix token file readability locally, then rerun `google-health-fitbit-mcp-server checkup`.");
  if (status.token.secure_permissions === false) steps.push("Restrict token file permissions locally, then rerun `google-health-fitbit-mcp-server checkup`.");
  if (status.token.exists && status.token.readable) steps.push("Run `google-health-fitbit-mcp-server checkup --live` locally for private scope/API details; public feedback reports do not read token contents.");
  if (!steps.length) steps.push("Ready for beta validation. Start with google_health_connection_status and google_health_data_inventory.");
  return steps;
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined): boolean {
  return Boolean(value && ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase()));
}

function isLocalHttpRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && Boolean(url.port);
  } catch {
    return false;
  }
}

function redactRedirectUri(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[redacted-invalid-redirect-uri]";
  }
}

function supportIssueBody(report: Omit<SupportReport, "issue_body">): string {
  return [
    "## Google Health MCP support bundle",
    "",
    "This bundle is redacted. It should not contain OAuth tokens, client secrets, or health measurements.",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```"
  ].join("\n");
}

function setupFeedbackIssueBody(report: Omit<SetupFeedbackReport, "issue_body">): string {
  return [
    "## Anonymous Google Health MCP setup feedback",
    "",
    "This bundle is redacted and intentionally anonymous. It should not contain OAuth tokens, Google Cloud client secrets, local file paths, raw token files or health measurements.",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
    "### Human notes",
    "",
    "- MCP client tested:",
    "- Device/source family:",
    "- Step that was confusing:",
    "- What worked well:",
    "- What should be clearer:"
  ].join("\n");
}
