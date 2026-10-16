import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { childEnvironment } from "../src/commands.js";
import {
  createWorkspace,
  runMaintenance,
  verifyWorkspace,
} from "../src/maintenance.js";

async function scriptedUpgrade(workspace) {
  const packagePath = join(workspace, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.dependencies.formatkit = "file:vendor/formatkit-v2";
  await writeFile(packagePath, JSON.stringify(pkg, null, 2));
  const sourcePath = join(workspace, "src/report.js");
  let source = await readFile(sourcePath, "utf8");
  source = source
    .replace("import { formatMoney }", "import { formatCurrency }")
    .replace(
      "formatMoney(totalMinorUnits, currency)",
      "formatCurrency({ minorUnits: totalMinorUnits, currency })",
    );
  await writeFile(sourcePath, source);
  execFileSync("npm", ["install", "--offline"], {
    cwd: workspace,
    stdio: "pipe",
    env: childEnvironment(),
  });
}

test("baseline installs cleanly but JPY test fails", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const report = await verifyWorkspace(workspace);
  if (report.checkDir)
    t.after(() => rm(report.checkDir, { recursive: true, force: true }));
  assert.equal(report.install.exitCode, 0);
  assert.equal(report.tests.exitCode, 1);
  assert.equal(report.passed, false);
});

test("upgraded app, lockfile and hidden checks pass from a fresh install", async (t) => {
  const result = await runMaintenance({
    agent: async (workspace) => {
      await scriptedUpgrade(workspace);
      return {
        completed: true,
        finalResponse: "Scripted upgrade for harness test",
      };
    },
  });
  t.after(() => rm(result.workspace, { recursive: true, force: true }));
  if (result.verification?.checkDir)
    t.after(() =>
      rm(result.verification.checkDir, { recursive: true, force: true }),
    );
  assert.equal(result.passed, true, JSON.stringify(result.verification));
  assert.deepEqual(result.verification.paths, [
    "package-lock.json",
    "package.json",
    "src/report.js",
  ]);
});

test("stale lockfile is rejected by npm ci", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const packagePath = join(workspace, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.dependencies.formatkit = "file:vendor/formatkit-v2";
  await writeFile(packagePath, JSON.stringify(pkg));
  const verification = await verifyWorkspace(workspace);
  if (verification.checkDir)
    t.after(() => rm(verification.checkDir, { recursive: true, force: true }));
  assert.equal(verification.passed, false);
  assert.notEqual(verification.install.exitCode, 0);
});

test("vendor edits violate the scope even when the upgrade works", async (t) => {
  const workspace = await createWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await scriptedUpgrade(workspace);
  const vendorPath = join(workspace, "vendor/formatkit-v2/index.js");
  await writeFile(
    vendorPath,
    (await readFile(vendorPath, "utf8")) + "\n// unrelated edit\n",
  );
  const verification = await verifyWorkspace(workspace);
  if (verification.checkDir)
    t.after(() => rm(verification.checkDir, { recursive: true, force: true }));
  assert.equal(verification.passed, false);
  assert.deepEqual(verification.invalidPaths, ["vendor/formatkit-v2/index.js"]);
});
