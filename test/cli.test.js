import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { childEnvironment } from "../src/commands.js";
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
test("normal CLI help, strict options and missing-key preflight never use account fallback", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deps-cli-")),
    env = childEnvironment();
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  let workspace;
  try {
    const run = (args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 15000,
      });
    assert.equal(run(["--help"]).status, 0);
    assert.equal(fs.readdirSync(directory).length, 0);
    for (const args of [
      ["--help", "extra"],
      ["--model"],
      ["--unknown", "x"],
      ["--model", "one", "--model", "two"],
    ])
      assert.notEqual(run(args).status, 0);
    const result = run(["--output-root", path.join(directory, "runs")]);
    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    workspace = output.workspace;
    assert.match(output.agentError, /OPENAI_API_KEY required/);
    const report = JSON.parse(fs.readFileSync(output.reportPath));
    assert.equal(report.passed, false);
    assert.equal(report.agentResult.runtime_home, undefined);
    assert.equal(report.agentResult.events.length, 0);
    assert.equal(fs.statSync(output.reportPath).mode & 0o777, 0o600);
    if (report.verification?.checkDir)
      fs.rmSync(report.verification.checkDir, { recursive: true, force: true });
  } finally {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
