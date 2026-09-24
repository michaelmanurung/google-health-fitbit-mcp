import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** A single-owner credential: possession grants access to the entire MCP surface. */
export function createHttpAuth(token = process.env.GOOGLE_HEALTH_MCP_AUTH_TOKEN): RequestHandler {
  if (!token || !/^[A-Za-z0-9_-]{43,}$/.test(token)) {
    throw new Error("HTTP transport requires GOOGLE_HEALTH_MCP_AUTH_TOKEN (at least 43 base64url characters). Generate it with: openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\\n'");
  }
  const expected = createHash("sha256").update(token).digest();

  return (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? "");
    const actual = createHash("sha256").update(match?.[1] ?? "").digest();
    if (!match || !timingSafeEqual(expected, actual)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="google-health-mcp"');
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
