import { runMaintenance } from "./maintenance.js";
const usage =
  "Usage: npm run maintain -- [--model ENABLED_MODEL] [--output-root DIRECTORY]. OPENAI_API_KEY is required for a private isolated Codex runtime.";
const args = process.argv.slice(2);
try {
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else {
    const config = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index],
        value = args[index + 1];
      if (
        !["--model", "--output-root"].includes(key) ||
        !value ||
        value.startsWith("--") ||
        Object.hasOwn(config, key)
      )
        throw new Error(usage);
      config[key] = value;
    }
    const controller = new AbortController();
    let interrupted;
    const handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [
        signal,
        () => {
          interrupted = signal;
          controller.abort(new Error(`Received ${signal}`));
        },
      ]),
    );
    for (const [signal, handler] of handlers) process.once(signal, handler);
    try {
      const result = await runMaintenance({
        model: config["--model"],
        outputRoot: config["--output-root"],
        signal: controller.signal,
      });
      console.log(
        JSON.stringify(
          {
            passed: result.passed,
            workspace: result.workspace,
            changedPaths: result.verification?.paths ?? null,
            installExitCode: result.verification?.install?.exitCode ?? null,
            testExitCode: result.verification?.tests?.exitCode ?? null,
            agentError: result.agentError,
            runnerError: result.runnerError ?? null,
            reportPath: result.reportPath,
          },
          null,
          2,
        ),
      );
      if (!result.passed)
        process.exitCode =
          interrupted === "SIGINT"
            ? 130
            : interrupted === "SIGTERM"
              ? 143
              : interrupted === "SIGHUP"
                ? 129
                : 1;
    } finally {
      for (const [signal, handler] of handlers)
        process.removeListener(signal, handler);
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      reportPath: error.report?.reportPath ?? null,
    }),
  );
  process.exitCode = 1;
}
