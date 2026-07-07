# Data Coverage

Google Health API v4 is still evolving, so real coverage of data types, source families, and operations (list/reconcile/rollup) can differ from the static plan in `src/constants.ts`.

## Static plan

Print the plan without calling Google:

```bash
npx -y google-health-fitbit-mcp-server coverage --json
```

## Live coverage

After OAuth setup, validate coverage against a real account:

```bash
npx -y google-health-fitbit-mcp-server coverage --live --json
```

This runs read-only checks per data type and reports which list/reconcile/rollup calls succeeded, failed, or returned no data. Output is redacted: no raw Google Health payloads or personal health measurements, only pass/fail status per data type and operation.

If an operation errors, compare the data type and operation against the [official Google Health data types page](https://developers.google.com/health/data-types) before assuming it's a bug in this server. Report confirmed gaps in a GitHub issue with the data type, source family, and operation status — never paste raw responses.
