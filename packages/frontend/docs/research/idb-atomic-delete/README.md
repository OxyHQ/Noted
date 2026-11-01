# IndexedDB audio deletion browser proof

This standalone fixture selects Noted's IndexedDB fallback and runs the actual
`deleteCaptureAudio`, `AudioArtifactStore` and web backend in a fresh Chromium
profile. It writes synthetic chunks and manifests for two captures, injects a
synchronous failure while scheduling the second delete, and verifies that the
first capture's chunks and manifest still exist unchanged. It also aborts after
the first request succeeds, then verifies successful and repeated deletion only
remove the selected capture. Only logging is stubbed.

The same synchronous-failure experiment against the previous implementation
failed: its first transaction had already committed the chunk removal. This
fixture tests a controlled browser scenario, not a spontaneous failure in a
user's environment, a complete account erase, OPFS, native files, device or
power-loss durability. An abort failure has uncertain physical outcome. The
transaction does not prove file ownership, protect quarantine from an older or
independent remover, or change account/session authorization.

With repository dependencies installed, run from its root:

```sh
CHROME_PATH=/path/to/chromium bun packages/frontend/docs/research/idb-atomic-delete/run-browser-proof.cjs
```

The fixture uses a fresh temporary server, browser profile and synthetic
IndexedDB storage, leaving the temporary directory for inspection. It never opens
a user's profile or storage.
