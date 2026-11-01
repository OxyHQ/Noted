# Outbox generation research (disconnected)

This experiment is not imported by the app. It does not change the shipped SQLite
schema, syncer, note writers, reset or erase. It is not a fix in production.
Nilo's optional generation protocol is disabled by default; legacy clients still
push without a generation. Do not enable the server protocol on the strength of
this experiment.

## Goal and proposed order

A pending offline create can currently be pushed before a pull notices a remote
workspace reset or notes erase. Because the server never saw that note, it can
be created after the deletion. An old or unknown outbox cannot safely be assigned
whatever generation the next pull happens to return.

The experimental statements model a conservative alternative:

1. An opt-in, authenticated server response must be validated before its token
   is recorded. Disabled, legacy, malformed, unavailable or ambiguous responses
   cannot establish a generation. How to make that request and establish actor
   and account authority is not implemented here.
2. In one account-pinned SQLite transaction, mark existing unknown or different
   generation intents as permanently blocked, then record the verified token.
   Both operations roll back on failure. Return to an earlier token cannot clear
   a block. The original outbox, notes, children and audio references remain in
   place: there is no automatic replay or local reset.
3. Each local note edit and the guarded enqueue must commit together. A new
   offline intent has an unknown generation. An existing unknown, old or blocked
   intent rejects a later edit instead of silently collapsing its contents into
   another epoch. A caller must surface that failure and give the user a safe
   recovery path, which does not yet exist. The transaction executor must check
   `expectedRowsAffected` and fail the whole transaction if it is not one.
4. Preflight detects any blocked row and refuses to even consider sending the
   batch. It is a diagnostic, not authorization. The server must check the
   captured generation on each create, patch and delete, including every retry.
   A generation mismatch, protocol-disabled response, unavailable server or
   unverified account must preserve the original local data and stop the path
   that would erase it. A local preflight can become stale immediately.

The `recordVerifiedGeneration` function takes a caller-supplied string; its name
expresses a precondition, not proof of the precondition. Test labels A and B are
synthetic. Nilo's actual tokens and response contract require their own HTTP/PG
integration tests. The marker is sticky even if a token is repeated, but this is
not proof that unobserved remote transitions, out-of-order responses, already
in-flight requests or old clients are fenced.

## Remaining barriers

- All note/outbox producers, conflict copies, attachments, reset and erase must
  participate in one reviewed protocol. An older app, process or tab can bypass
  these disconnected statements. SQLite transaction serialization alone does
  not prove all processes, native drivers or account lifecycle participate.
- Pin the viewer through the entire SQLite transaction, including COMMIT, and
  handle ambiguous BEGIN/COMMIT, rollback and close without attributing the
  transaction to a later account. Another experiment studies this; it is not
  enabled or assumed here.
- A network request and attachment linking are outside the SQLite transaction.
  The server must enforce the same captured token, and the app still needs a
  stable payload snapshot, account/session checks, and a policy for requests or
  links already in flight. A rejected Nilo write does not undo an Oxy link.
- Blocking the rows preserves them only while other writers and erasers leave
  them alone. There is no durable recovery UI, copy of audio, physical ownership
  authority, safe deletion, export, or guarantee that external files persist.
  Existing local erase and audio routes are not fenced by this experiment.
- The full pull and reset need a non-destructive quarantine/recovery protocol,
  including attachments, captures, transcript and changes made concurrently.
  Do not call the current `eraseLocalAccountData` when encountering a mismatch.
- Token validation, pagination, stable readback, retries, 409 versus 503 and
  rollout with mixed server/client versions need end-to-end HTTP/PG/SQLite tests.
  No device or platform-specific storage adapter has been exercised here.

## Evidence

The adjacent tests apply the app's migrations and these additional experimental
statements to real SQLite databases. They check legacy migration and reopen,
retained note/outbox and a fixture file, mismatched generations, A-B-A, a failed
transaction, and a competing SQLite connection. A test also demonstrates that
a previously obtained preflight result stays true after the generation changes;
therefore it cannot be used as a network barrier. The tests execute statements
through a small synchronous test harness, not the native/web production driver,
account lifecycle, an HTTP client, or a physical-audio authority.
