import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { command, succeeded } from "./commands.js";
import {
  rememberBaseline,
  captureBaseline,
  changedPaths,
  inspectScope,
  materialize,
  checkPackageIntent,
  snapshot,
  sameSource,
} from "./scope.js";
import { prepareReport, saveReport } from "./evidence.js";
import { runCodex } from "./native.js";
export { runCodex, captureBaseline, changedPaths };
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  seed = join(root, "seed"),
  grader = join(root, "grader/check.js");
export async function createWorkspace(options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "firedrill-codex-deps-"));
  try {
    await options.onWorkspace?.(workspace);
    options.signal?.throwIfAborted();
    await cp(seed, workspace, {
      recursive: true,
      filter: (path) => basename(path) !== "node_modules",
    });
    for (const args of [
      ["init", "-q"],
      ["add", "--force", "--", "."],
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-q",
        "-m",
        "seed",
      ],
    ]) {
      const result = await (options.runCommand ?? command)(
        "git",
        args,
        workspace,
        { signal: options.signal },
      );
      if (!succeeded(result))
        throw new Error(`git ${args[0]} failed: ${result.stderr}`);
    }
    await rememberBaseline(workspace, options);
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyWorkspace(
  workspace,
  baseline = captureBaseline(workspace),
  { signal, runCommand = command } = {},
) {
  const checked = await inspectScope(workspace, baseline, {
      signal,
      runCommand,
    }),
    candidate = checked.source,
    invalid = new Set(checked.invalidPaths),
    paths = new Set(checked.paths);
  const result = {
    baseline,
    paths: [],
    invalidPaths: [],
    candidate_sha256: candidate.snapshot_sha256,
    checkDir: null,
    install: null,
    tests: null,
    hidden: null,
    passed: false,
  };
  let copy;
  const recheck = async () => {
    const current = await inspectScope(workspace, baseline, {
      signal,
      runCommand,
    });
    for (const file of current.paths) paths.add(file);
    for (const file of current.invalidPaths) invalid.add(file);
    if (!sameSource(candidate, current.source))
      throw new Error("Candidate source changed during verification");
    if (
      copy &&
      snapshot(result.checkDir).snapshot_sha256 !== copy.snapshot_sha256
    )
      throw new Error("Fresh validation source changed while executing checks");
  };
  const guard = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    signal?.throwIfAborted();
    await recheck();
  };
  try {
    signal?.throwIfAborted();
    if (invalid.size) return result;
    checkPackageIntent(candidate);
    result.checkDir = await mkdtemp(
      join(tmpdir(), "firedrill-codex-deps-check-"),
    );
    materialize(candidate, result.checkDir);
    copy = snapshot(result.checkDir);
    if (copy.snapshot_sha256 !== candidate.snapshot_sha256)
      throw new Error("Materialized candidate source differs");
    await guard();
    result.install = await runCommand(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      result.checkDir,
      { signal },
    );
    await guard();
    if (succeeded(result.install)) {
      result.tests = await runCommand("npm", ["test"], result.checkDir, {
        signal,
      });
      await guard();
    }
    if (succeeded(result.tests)) {
      result.hidden = await runCommand(
        process.execPath,
        [grader, result.checkDir],
        root,
        { signal },
      );
      await guard();
    }
    result.passed =
      invalid.size === 0 &&
      ["package.json", "package-lock.json", "src/report.js"].every((file) =>
        paths.has(file),
      ) &&
      succeeded(result.install) &&
      succeeded(result.tests) &&
      succeeded(result.hidden);
  } catch (error) {
    result.error = { name: error.name, message: error.message };
    result.passed = false;
  } finally {
    result.paths = [...paths].sort();
    result.invalidPaths = [...invalid].sort();
  }
  return result;
}
export async function runMaintenance({
  agent = runCodex,
  model,
  timeoutMs,
  codexPath,
  providerBaseUrl,
  signal,
  outputRoot = ".runs",
  writer = saveReport,
} = {}) {
  const report = {
    schema_version: 1,
    ...prepareReport(outputRoot),
    started_at: new Date().toISOString(),
    status: "running",
    workspace: null,
    baseline: null,
    baselineInstall: null,
    baselineTest: null,
    agent_kind: agent === runCodex ? "native_sdk" : "caller_injected_agent",
    agentResult: null,
    agentError: null,
    verification: null,
    passed: false,
    commands: [],
  };
  let recordingFailure = null;
  const save = async () => {
    if (recordingFailure) throw recordingFailure;
    try {
      await writer(report.reportPath, structuredClone(report));
    } catch (error) {
      recordingFailure = error;
      throw error;
    }
  };
  const runCommand = async (name, args, cwd, options = {}) => {
    const record = {
      name,
      args: [...args],
      cwd,
      status: "prepared",
      prepared_at: new Date().toISOString(),
      result: null,
    };
    report.commands.push(record);
    await save();
    signal?.throwIfAborted();
    const result = await command(name, args, cwd, {
      ...options,
      signal: options.signal ?? signal,
    });
    record.result = result;
    record.status = "finished";
    await save();
    return result;
  };
  try {
    await save();
    signal?.throwIfAborted();
    report.workspace = await createWorkspace({
      signal,
      runCommand,
      onWorkspace: async (workspace) => {
        report.workspace = workspace;
        await save();
      },
    });
    report.baseline = captureBaseline(report.workspace);
    await save();
    signal?.throwIfAborted();
    report.baselineInstall = await runCommand(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      report.workspace,
      { signal },
    );
    await new Promise((resolve) => setImmediate(resolve));
    signal?.throwIfAborted();
    report.baselineTest = succeeded(report.baselineInstall)
      ? await runCommand("npm", ["test"], report.workspace, { signal })
      : null;
    report.baselineValid =
      succeeded(report.baselineInstall) &&
      report.baselineTest?.exitCode === 1 &&
      !report.baselineTest.signal &&
      !report.baselineTest.error;
    const prepared = await inspectScope(report.workspace, report.baseline, {
      signal,
      runCommand,
    });
    if (prepared.paths.length)
      throw new Error("Preparation changed original source before the agent");
    await save();
    if (!report.baselineValid)
      throw new Error(
        "Original baseline must install successfully and fail its known JPY compatibility test",
      );
    try {
      report.agentResult = await agent(report.workspace, {
        model,
        timeoutMs,
        cliPath: codexPath,
        baseUrl: providerBaseUrl,
        signal,
        onObservation: async (observation) => {
          report.agentResult = observation;
          await save();
        },
      });
      if (
        !report.agentResult?.completed ||
        typeof report.agentResult.finalResponse !== "string" ||
        !report.agentResult.finalResponse.trim()
      )
        throw new Error("Agent did not return completed nonblank output");
    } catch (error) {
      report.agentError = error.message ?? String(error);
      if (error.observation) report.agentResult = error.observation;
    }
    if (!recordingFailure)
      report.verification = await verifyWorkspace(
        report.workspace,
        report.baseline,
        { signal, runCommand },
      );
    signal?.throwIfAborted();
    report.passed =
      !report.agentError &&
      !recordingFailure &&
      report.verification?.passed === true;
  } catch (error) {
    report.runnerError = error.message ?? String(error);
  } finally {
    report.passed = report.passed === true;
    report.status = report.passed ? "passed" : "failed";
    report.finished_at = new Date().toISOString();
    if (recordingFailure) {
      report.evidenceError = recordingFailure.message;
      report.passed = false;
      report.status = "failed";
    }
    try {
      await writer(report.reportPath, structuredClone(report));
    } catch (error) {
      report.evidenceError = error.message;
      report.passed = false;
      report.status = "failed";
      try {
        await writer(report.reportPath, structuredClone(report));
      } catch {
        report.last_durable_receipt_status = "unknown";
      }
      error.report = report;
      throw error;
    }
  }
  return report;
}
