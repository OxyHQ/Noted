# @noted/backend

The Noted API: Express + TypeScript over PostgreSQL, with Socket.IO for real-time sync. See the [repository README](../../README.md) for the product and how the pieces fit.

## Running it

```bash
# from the repository root
bun run dev:backend

# from this package
bun run dev            # bun --watch
bun run test           # vitest
bun run db:generate    # drizzle-kit, after changing the schema
bun run db:migrate --target-database=noted_dev
```

A local PostgreSQL is `docker compose -f docker-compose.postgres.yml up -d postgres` from the repository root. Redis is optional — caching and Socket.IO scaling fall back gracefully without it.

## Routes

| prefix | what it serves |
|---|---|
| `/health` | liveness and readiness, including the database |
| `/auth` | the Oxy auth webhook |
| `/notes` | note CRUD, plus the bulk reorder |
| `/labels` | label management |
| `/notifications` | push delivery and Web Push subscriptions |
| `/feedback` | the in-app feedback inbox |

Every note query is filtered by `oxyUserId`, and socket rooms are joined from the server-verified id (`user:${userId}`) rather than anything the client names. There is no shared or public surface: no note carries a visibility, audience, collaborator or share-link field.

## Environment

`.env.example` documents the supported variables and what happens when one is
missing.

`DATABASE_URL` is the only required database setting. Oxy
`ApplicationCredential` values enable catalogue/capability operations and
signed Noted events; they are product-service identity, not AI provider keys.
`ALIA_API_URL` is used only to deliver those events to the Alia agent runtime.
Current transcription and note enhancement run on-device. Any future hosted
point inference must call Oxy, which alone routes to Kaana; any future
agent/chat/tools/memory capability must call Alia, which then calls Oxy.

No OpenAI, Anthropic, Google, Groq or other provider key belongs in this
environment. Provider keys live only encrypted in Kaana PostgreSQL/KMS, whose
only canonical signed origin is `https://kaana.ai`.

## Database

PostgreSQL through drizzle (over postgres.js, via `@oxy.so/db`). Schema in `src/db/schema/`, migrations in `drizzle/`, connection in `src/db/postgres.ts`.

- **Every generated migration needs a `-- oxy:deploy-phase=pre|post` marker.** `db:migrate` refuses to apply an unmarked one, before any DDL runs.
- **Postgres has no TTL index.** Anything that would have carried one needs an entry in `src/db/expiry.ts` — the sweep that replaces it — or the table grows forever with no error and no failing test.

## Reminders

`src/lib/reminders.ts` owns the reminder cron: `startReminderScheduler()` / `stopReminderScheduler()`, started from `src/index.ts`.
