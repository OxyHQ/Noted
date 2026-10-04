# Noted: published SDK adoption

Source `181dc19cc9c5b5186e0923c59e66c7782e82bf5d` pins the published SDK and its measured compatible Bloom version, including the regenerated lockfile. Existing application behavior and previously reviewed fixes remain in the branch.

Validation: {"frontendFiles": 2, "frontendPassed": 14, "backendFiles": 2, "backendPassed": 14, "sdkImporterMembers": 7214, "bloomImporterMembers": 41880, "buildExport": "passed"}. Exact commands, logs, archive member hashes and importer resolutions are in [proof.json](proof.json).

- Published registry archives and all installed SDK importer members were compared byte for byte. Stale same-version candidate materializations were retained and repaired with a frozen install; their setup failures remain in the records.
- Local web export proves compilation, not browser/native acceptance or deployed public-client configuration. Required PR/main CI and root image/promotion remain separate.
- No production database, provider writes, grants, credentials or auth fixtures were changed. Owned PostgreSQL was stopped and its PID absence verified.
- Backend focal mocks the OxyServer auth boundary; it tests application wiring and is not a cryptographic issuer/receiver acceptance claim. Frontend tests use loopback HTTP with the actual published linked client.
