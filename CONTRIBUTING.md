# Contributing

Thanks for improving Google Health MCP Unofficial.

Before opening a PR:

```bash
npm install
npm test
```

Guidelines:

- Use only official Google Health API endpoints.
- Keep default behavior read-only.
- Treat GPS data as sensitive.
- Do not add write/upload tools without explicit safety gates.
- Do not log or return OAuth tokens.
- Do not expose MCP tools that revoke OAuth grants, disconnect accounts, or delete account credentials, including aliases or opt-in variants. These operations belong outside MCP.
- Update docs and tests with behavior changes.

## Nutrition write

`google_health_log_nutrition` accepts structured food estimates from the chat host. Its default preview is local and requires no OAuth scope. A live write requires a matching preview fingerprint, explicit user confirmation represented by `explicit_user_intent=true`, and the `nutrition-write` OAuth scope. The endpoint, `nutritionLog` envelope, units, and write scope follow the [Google nutrition guide](https://developers.google.com/health/data-types/nutrition) and [create reference](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/create).

Live creates are sequential and do not automatically retry ambiguous failures. Preserve the receipts and report partial results so users can check Google Health before retrying. Real account behavior remains to be verified with an authorized test entry.
