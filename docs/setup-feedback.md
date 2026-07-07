# Setup Feedback

Google Health MCP is beta while the Google Health API v4 stabilizes. If you hit setup friction, unclear tool names, missing data types, or privacy boundaries that feel wrong, an anonymous report helps prioritize fixes.

Run:

```bash
npx -y google-health-fitbit-mcp-server support --feedback --json
```

This prints a redacted, anonymous bundle: Node/OS version, setup status, which steps failed, and which data types were reachable. It does not include OAuth tokens, client secrets, or personal Google Health data.

Review the output yourself, then open a GitHub issue on the repository and paste the bundle in. Redact anything that still looks sensitive before posting.
