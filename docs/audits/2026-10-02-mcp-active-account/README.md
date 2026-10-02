# MCP active-account consumer correction

Source candidate for Oxy I11 [#1527](https://github.com/OxyHQ/oxy/issues/1527). Base `806e9cae040a7d9446557e7ce9eda64069116056` was the remote main head checked on 2026-10-02. This is a product implementation test, separate from the reduced I04 fixtures.

When an OAuth connection originates at A and selects B, the published `@oxy.so/mcp@1.0.0` validates the token and exposes `accountId` (origin) and `activeAccountId` (selected account). The product authorization callback and the canonical handler wrapper now both use B for domain authority/data. The unchanged baseline rejects the B invocation because its callback returns A. Fixing just that callback would leave the handler reading A.

Noted retains its private-only model: the canonical SQL queries filter notes, generated artifacts and labels by the effective account. Real HTTP fixtures list/read B's private data and reject A's note. No sharing or collaborator permission is introduced.

## Reproduce locally

Use a disposable PostgreSQL17 server authorized to create/drop test databases; Mercaria also requires installed PostGIS and `max_locks_per_transaction=256`. The recorded owned loopback server is described in [evidence.json](evidence.json); no shared-server configuration was changed. No `.env` containing real credentials is needed.

```sh
bun install --frozen-lockfile --minimum-release-age=0 --ignore-scripts
bun run build:types
cd packages/backend
env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER -u PGPASSWORD -u DATABASE_URL \
  TEST_DATABASE_URL=postgres://oxy@127.0.0.1:5557/postgres \
  bun run test src/capabilities/__tests__/noted-active-account.realdb.test.ts
bun x --no-install tsc --noEmit
```

The suite uses real product MCP HTTP service, published protocol validation and canonical domain SQL. Only central introspection are synthetic. Every unexpected global `fetch` rejects and is asserted absent, including at teardown, so swallowed enrichment errors cannot create a false pass. HTTP calls use `node:http` to loopback with the canonical resource Host header; no live Oxy API or financial adapter is needed in the final fixture. Test databases use the guarded shared `@oxy.so/db/testing` helper and real product migrator, and are dropped after each run.

Final focused validation: **3 suites/7 tests**, backend build, TypeScript, and scoped ESLint with `--max-warnings=0` pass. Logs and source/installed-module hashes are durable in [evidence.json](evidence.json). The same final fixtures against unchanged baseline source are RED (3 failures); earlier fixture errors and the Mercaria public-profile lookup are recorded separately.

## Remaining acceptance

This fix uses published APIs and changes no dependency manifest, lockfile, scope, credential, catalogue, migration or deployment. I04's new discriminated InvocationHandlers/internal MCP lane has not been adopted here. Coordinated actual releases, registration, full HTTP/internal-MCP/external-MCP parity, audit persistence, real consent and deployed account-switch verification remain separate gates. No issue is closed by this local candidate.

Initial draft CI [37059404357](https://github.com/OxyHQ/Noted/actions/runs/37059404357) refused the new real-DB fixture because the workflow provided neither PostgreSQL nor TEST_DATABASE_URL (64 existing tests passed, 3 new cases skipped after setup failure). The followup provisions postgres17 with a healthcheck and supplies the synthetic URL only to API tests. The fixture remains mandatory; followup CI is pending. No deployment workflow changed.

The followup also passed the entire local backend package script: 10 suites/67 tests with the owned PostgreSQL URL; YAML/service binding validation passes. Functional source is unchanged from the original candidate.
