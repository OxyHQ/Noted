# Noted final SDK source compatibility

Source `38f8c3ff77eecf05cd94531de01fd8fe97dfc2ce` builds on accepted OAuth
active-account source `0569162d338c278c55bf1c8b239efa78581dddb6`. Candidate Oxy
packages were freshly built and packed from `f364fe58a41aab6913cf92ec01a9a9c1ea489120`;
Bloom 6.2.1 is published. [proof.json](proof.json) records source, local install
inputs, results and complete logs. Root review is pending for this checkpoint.

The frontend mounts the same `OxyServices` instance used by
`createLinkedClient`. It removes the local bearer getter/interceptor. The thin
Noted response adapter calls the SDK's `requestAuthenticatedResponse` and keeps
the existing `{ data: body }` caller shape: the **entire** Noted sync body
`{ data, deleted, serverTime }` survives. It preserves query values, JSON writes,
404 deletion handling and backend error bodies, with one 10-second deadline
through response-body reading. Authentication and the single 401 refresh belong
to the SDK. No local token exchange, store, refresh handler or auth fallback was
added. `/auth/me` reuses the existing backend `OxyServer`.

Four tests run real loopback HTTP with the installed SDK: full sync envelope and
session A/B changes; clear/no-session denial before HTTP; one delegated 401
refresh with identical POST bodies, 404 and 403 preservation; and a stalled
response body aborted without retrying its write. Synthetic JWT session state
is explicitly not Oxy verification. The product MCP fixture additionally runs
real HTTP, product handlers and PostgreSQL for origin A / active B isolation and
next-call revocation, with only central introspection synthetic.

Final checks: backend 10 suites / 67 tests; frontend 71 suites / 836 tests;
backend/frontend strict types; API build; Expo web export; changed backend route
ESLint with zero warnings. The app has no frontend lint script. Installed files
match the five candidate tarballs and all 20,940 files of registry Bloom 6.2.1.
The fixture owned PostgreSQL on port 5595, PID 3968260; its test database was
dropped, the only remaining databases were postgres/template0/template1, and
the owned server was stopped with PID absence and port closure verified.

The initial standalone test invocation used a wrong path and found no tests;
its log is retained separately from the four-test success. The initial 832-test
frontend run preceded the adapter; the final 836-test run includes it. Web export
retains dependency/Metro warnings and does not establish rendered/native parity.

## Legacy routes and final gates

The mounted `routes/auth.ts` serves `/me`, `/logout` and retired 410 routes for
Codea/Cowork/token. It does not mount forgot-password/reset-password; there is no
mounted `/bots` router. Old frontend screens still refer to those unsupported
endpoints. This change does not revive them or add a public auth backend;
current sign-in remains the registered OxyProvider/dialog. The protected domain
client now refuses requests without a session before transport.

The initial candidate inherited keyboard-controller 1.20.7 below the final
Services peer >=1.21.0. The candidate now aligns upward to 1.21.6 and lists it in
`expo.install.exclude`; types and web export passed again. Earlier test runs
remain identified by their original installation. No native runtime was run.

Actual package manifests and `bun.lock` remain local candidate modifications,
with evidence copies under `candidate-install/`; they are not committed as
final registry adoption. After publication: install exact registry Oxy targets,
regenerate locks, verify installed artifacts and applicable package/CI checks,
then coordinate promotion and runtime acceptance with root. No production or
shared native fixture was modified.
