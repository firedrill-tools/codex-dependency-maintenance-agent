# Codex dependency maintenance agent

A standalone Codex SDK application upgrades a synthetic invoice-summary repository from local formatkit v1 to a breaking v2 API with JPY support. It verifies the exact candidate from a **separate fresh offline npm install**, preserving vendor packages, tests and unrelated files.

## Run

Requires Node.js20+, Git and npm on a local POSIX filesystem. The SDK is pinned to0.162.1. An owned run uses an explicit `OPENAI_API_KEY` and a private temporary Codex home; caller account configuration is not a fallback.

```sh
npm ci
npm test
npm run maintain -- --model YOUR_ENABLED_ACCOUNT_MODEL
```

Choose an enabled account model. Omitting `--model` leaves selection to the isolated SDK/CLI default; the report records a null requested model and unknown actual model until exposed by the protocol. No model is substituted. A live run uses account capacity. Refreshed paid runs remain a separate portfolio gate.

`npm run maintain -- --help` needs no key and performs no run. `--model` and `--output-root` are strict, unique options with values. Reports default to fresh `.runs/<run-id>/trace.json` directories (0700, file0600). The report identifies the retained disposable checkout and separate validation copy so failed/partial changes can be inspected. Grading answers remain outside the target checkout and prompt.

## Verification authority

The application records the original Git commit **and complete original file/directory facts before the agent starts**. Scope inspection compares captured bytes, modes and types against that trusted original, including ignored files and changes committed to a new HEAD. Current HEAD cannot become a new baseline. Only package.json, package-lock.json and src/report.js may change; protected entry points, aliases, extra files and changed package metadata/scripts are blocked before validator execution.

A coherent checked snapshot is materialized into a new private validation directory. `npm ci --offline --ignore-scripts --no-audit --no-fund` installs its local dependency, followed by the unchanged public tests and external grader. The fixture packages need no lifecycle scripts. Source facts are checked again between commands, so candidate changes and self-modification during fresh checks fail. Generated root node_modules and Git metadata are outside business-file comparison; the fresh validator does not reuse either. Synchronous commands currently request30-second timeouts and cap captured output at1MiB; full process supervision remains in PLAN.md.

Baseline must actually install and exit1 on its known JPY incompatibility. A stale lock or unsuccessful upgrade cannot pass. npm12's inherited npm_config_allow_scripts wrapper option is removed only from child environments; user configuration is unchanged. Mode-preserving materialization also works under a private umask.

## Native completion and evidence

The actual installed SDK/public executable seam is exercised with a controlled synthetic CLI child. A successful adapter result needs a thread, one active turn, coherent item identities, no pending work, a terminal turn.completed and a nonblank final answer. Tool activity invalidates earlier progress prose. Missing/blank/replayed/unknown/trailing/in-progress output, external tools, malformed/oversized events, failures and cooperative cancellation cannot pass. These checks validate the returned protocol; the CLI may already have edited the disposable checkout. Failed protocol/recording attempts retain those actual changes.

Original decoded SDK events, unknown fields, errors, usage, task hash and requested model remain in private prepared/failed receipts. SDK-observed missing/invalid/zero counters are separate from unknown provider measurements/cost. SDK0.162.1 inserts absent cache_write_input_tokens=0; it must not be called original provider or raw CLI evidence. A completed upgrade followed by a native failure still fails the overall run while its independent compatibility result and changed files remain visible. Recording faults stop further verification and retain failed/in-memory evidence when possible.

**44 offline checks pass**, including actual SDK protocol/upgrade/fresh npm validation, original-head scope, committed/ignored/type/alias/script mutations, source continuity, private modes, caller completion, recording faults and real key-negative CLI. These controlled results are distinct from the [historical live proof](evidence/live-maintenance.md), which is unchanged.

## Remaining work and scope

[PLAN.md](PLAN.md) retains process supervision/raw CLI/ownership qualification, richer coherent datasets/private case CLI and a fresh complete source archive. An actual probe shows that a child ignoring SIGTERM can outlive the SDK deadline; bounded forced termination must be implemented before stronger lifecycle claims. Commands also need owned asynchronous process cleanup. Decoded event bounds do not establish raw stdout/stderr, peak heap, provider retries or billing bounds.

The changed-file check is an application policy gate, not an OS sandbox for arbitrary malicious code. Use disposable synthetic repositories. The CLI receives workspace-write/network-disabled/web-search-disabled/never-approve settings, but the grader's location outside working context alone is not an enforced read boundary. Source/API protocol and fixture compatibility are qualified independently from live semantic quality and account behavior.

[Scenarios](scenarios/README.md) currently describe clean/stale-lock/protected-vendor/unsuccessful cases. New Firedrill integration requires the qualified release/contract/persisted scenarios. Publication/license choices remain parked; this repository is private.

References: [official Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), pinned installed SDK declarations/implementation and actual controlled native/Git/npm probes. Explore the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog), [Firedrill](https://firedrill.run/) and [official developer documentation](https://docs.firedrill.run/).
