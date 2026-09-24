# Security Policy

Report security issues through GitHub issues if they do not contain secrets, or email klcogluberk@gmail.com for anything sensitive. Do not paste OAuth tokens, client secrets, raw GPS exports or private activity payloads.

## Sensitive Data

- Google Health client secret
- OAuth access and refresh tokens
- Raw activity streams
- GPS coordinates, route maps and polylines
- Private activity metadata
- HTTP MCP bearer secret (`GOOGLE_HEALTH_MCP_AUTH_TOKEN`)

## Defaults

- Tokens stay local under `~/.google-health-mcp/tokens.json`.
- Local config is written with `0600` permissions where supported.
- The server is read-only by default.
- GPS/map data is redacted unless explicitly requested.
- HTTP requires a separately generated bearer secret, including on loopback. Authentication runs before MCP body parsing and dispatch; `/health` and CORS preflights remain public.
- The HTTP secret authorizes all tools and resources for one account. Remote deployments require HTTPS at a reverse proxy and an isolated backend; the built-in HTTP listener does not encrypt traffic. See the HTTP setup in README.md.
