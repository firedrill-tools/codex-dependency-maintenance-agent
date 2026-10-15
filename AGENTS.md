# Working rules

Keep the seed and both vendor packages synthetic. Do not let the repair agent modify either vendor directory, tests or unrelated documentation. Validate a dependency change from a separate fresh `npm ci --offline` install; a passing test in an old `node_modules` directory does not prove lockfile consistency.

The grader stays outside the agent checkout. Do not call scripted tests live Codex proof. Add Firedrill integration only against the verified new release.
