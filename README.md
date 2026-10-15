# Codex dependency maintenance agent

A standalone Codex SDK application that upgrades a synthetic invoice-summary repository from a local `formatkit` v1 package to a breaking v2 package. Version 2 changes the formatting API and handles JPY zero-decimal amounts. The application gives Codex a fresh disposable Git checkout, then verifies application behavior and package-lock consistency from a separate fresh `npm ci --offline` install.

## Run

Requires Node.js 20+, Git, npm and a Codex SDK login or `OPENAI_API_KEY` for a live maintenance run.

```sh
npm ci
npm test
npm run maintain
```

`--model MODEL` is optional; omission uses the SDK's configured model. The live command uses account capacity. Reports are saved under ignored `.runs/` and print the disposable checkout path.

The runner records the initially passing `npm ci --offline` and failing JPY test. It asks Codex to change only `package.json`, `package-lock.json` and `src/report.js`, with network and web search disabled. After the agent exits, a new validation directory runs `npm ci --offline`, public tests and a hidden grader outside the checkout. The grader checks the v2 dependency path, lockfile links, CAD/JPY behavior and error cases. Git diff inspection rejects vendor, test and unrelated changes.

This changed-file check is an application policy gate, not a hard security boundary for malicious code. Use only disposable synthetic repositories. A successful `npm test` of this harness demonstrates the scripted upgrade path, not a real Codex decision. A successful live SDK upgrade is recorded in [evidence/live-maintenance.md](evidence/live-maintenance.md).

## Scenarios and limits

[Scenarios](scenarios/README.md) include a clean upgrade, stale lockfile, changed vendor code and an unsuccessful attempt. The application has no external package registry dependency because both package versions are local. It does not demonstrate arbitrary npm upgrade compatibility.

Firedrill integration will be added against the verified new release. This repository is private and has no selected public license.

Implementation reference: [Codex SDK](https://developers.openai.com/codex/sdk).

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
