# Live Codex SDK dependency maintenance proof

Run: 2026-10-15, `@openai/codex-sdk` 0.162.1, default account model, using `npm run maintain` against a fresh disposable checkout. Baseline `npm ci --offline` passed and the public JPY test failed as expected.

The live SDK agent read the local v1/v2 package APIs, changed `package.json` and `src/report.js`, regenerated `package-lock.json` using npm, then ran `npm ci --offline` and `npm test` successfully. The runner's independent fresh install also passed, followed by both public tests and the external hidden grader. The Git diff contained exactly `package.json`, `package-lock.json` and `src/report.js`; vendor, test and unrelated files were untouched.

SDK usage for this turn: 168,379 input tokens (156,928 cached) and 1,932 output tokens (480 reasoning output). The local ignored `.runs/` JSON report contains the command/file-change trace and check outputs. This proof covers the local breaking dependency upgrade only, not arbitrary package upgrades or Firedrill integration.
