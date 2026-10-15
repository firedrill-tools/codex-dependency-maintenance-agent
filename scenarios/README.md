# Dependency maintenance scenarios

Every run copies the same synthetic seed into a new temporary Git repository.

| Case | Expected result |
|---|---|
| Breaking upgrade | Change dependency to local v2, adapt `renderInvoice`, update the lockfile and pass `npm ci --offline`, public tests and hidden checks. |
| Stale lockfile | Change only `package.json` to v2. Fresh `npm ci --offline` must fail. |
| Vendor tampering | Modify the v2 package to keep the old API. Even if tests pass, the changed-file boundary rejects this path. |
| Unsuccessful agent | Leave the seed unchanged or exit with an error. The runner reports failure and preserves the workspace and report for inspection. |

Offline harness tests use a scripted edit, not a model. A real Codex run is a separate proof and must include its SDK trace, changed paths and validation exits.
