# I11 HTTP review follow-up

Non-JSON 404/403 responses now preserve their known status and a safe generic message instead of throwing JSON.parse before error classification. JSON error bodies remain intact; malformed successful JSON remains an error. Real loopback RED was 2 failures / 5 passes, then 7 passes.

With core candidate 04f73b2a7, Noted also tests its own short deadline during both preflight and post-401 shared refresh waits. The caller rejects before releasing the refresh barrier, with respectively zero or one server request; releasing it produces no retry. Final HTTP suite: 9 passes. Full frontend: 71 suites / 841 passes. TypeScript passes using `bunx --no-install tsc --noEmit`; this package has no `typecheck` script (the initial command error was setup only).

The former refresh fixture returned a different account A→B. It now rotates a nonce within session A: the new SDK correctly refuses to replay an A write as B, whose separate regression lives upstream. No app token plumbing was added. All installed core package files match the candidate tarball; this is not a registry-adoption or native-runtime claim. Original source/proof remain preserved in the parent directory.
