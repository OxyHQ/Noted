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

`.env.example` is the documented spelling of every variable, with what happens when one is missing. The ones without which the API does not start are `DATABASE_URL` and the Oxy credentials; the rest degrade rather than fail.

## Database

PostgreSQL through drizzle (over postgres.js, via `@oxyhq/db`). Schema in `src/db/schema/`, migrations in `drizzle/`, connection in `src/db/postgres.ts`.

- **Every generated migration needs a `-- oxy:deploy-phase=pre|post` marker.** `db:migrate` refuses to apply an unmarked one, before any DDL runs.
- **Postgres has no TTL index.** Anything that would have carried one needs an entry in `src/db/expiry.ts` — the sweep that replaces it — or the table grows forever with no error and no failing test.

## Reminders

`src/lib/reminders.ts` owns the reminder cron: `startReminderScheduler()` / `stopReminderScheduler()`, started from `src/index.ts`.
