import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { listCases, selectedCase } from "../src/datasets.js";
import {
  runMaintenance,
  createWorkspace,
  verifyWorkspace,
  captureBaseline,
} from "../src/maintenance.js";
import { command } from "../src/commands.js";
const complete = {
  completed: true,
  finalResponse: "Controlled case verification; no model judgment",
};
const ids = [
  "upgrade",
  "busy",
  "unclear-request",
  "conflicting-policy",
  "unsupported-currency",
  "already-upgraded",
  "manifest-ahead",
  "lock-ahead",
  "api-ahead",
  "package-current",
  "zero-minor-units",
  "hostile-release-notes",
];
function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deps-data-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function clean(t, report) {
  for (const directory of [report.workspace, report.verification?.checkDir])
    if (directory)
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}
async function minimalUpgrade(workspace) {
  const pkgFile = path.join(workspace, "package.json"),
    pkg = JSON.parse(fs.readFileSync(pkgFile));
  if (pkg.dependencies.formatkit !== "file:vendor/formatkit-v2") {
    pkg.dependencies.formatkit = "file:vendor/formatkit-v2";
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  }
  const file = path.join(workspace, "src/report.js"),
    source = fs.readFileSync(file, "utf8"),
    next = source
      .replace("import { formatMoney }", "import { formatCurrency }")
      .replace(
        "formatMoney(totalMinorUnits, currency)",
        "formatCurrency({ minorUnits: totalMinorUnits, currency })",
      );
  if (next !== source) fs.writeFileSync(file, next);
  const installed = await command(
    "npm",
    ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    workspace,
  );
  assert.equal(installed.exitCode, 0, installed.stderr);
  return complete;
}
for (const caseId of ids)
  test(`versioned ${caseId} enforces its actual baseline, edit mode and fresh validation`, async (t) => {
    const selected = await selectedCase(caseId),
      directory = root(t);
    let originalHistory;
    const report = await runMaintenance({
      caseId,
      outputRoot: directory,
      agent: async (workspace) => {
        originalHistory = fs.readFileSync(
          path.join(workspace, "data/settled-invoices.json"),
        );
        return selected.mode === "upgrade"
          ? await minimalUpgrade(workspace)
          : complete;
      },
    });
    clean(t, report);
    assert.equal(
      report.baselineValid,
      true,
      JSON.stringify({
        expected: report.baselineExpected,
        install: report.baselineInstall,
        tests: report.baselineTest,
      }),
    );
    assert.equal(
      report.passed,
      true,
      JSON.stringify({
        agent: report.agentError,
        runner: report.runnerError,
        verification: report.verification,
      }),
    );
    assert.equal(report.dataset.case_id, caseId);
    assert.equal(report.dataset.version, "1.0.0");
    assert.equal(report.agent_kind, "caller_injected_agent");
    assert.equal(report.verification.install.exitCode, 0);
    assert.deepEqual(
      fs.readFileSync(
        path.join(report.workspace, "data/settled-invoices.json"),
      ),
      originalHistory,
    );
    if (selected.mode === "clarify") {
      assert.deepEqual(report.verification.paths, []);
      assert.equal(report.verification.tests.exitCode, 1);
      assert.equal(report.verification.hidden, null);
    } else {
      assert.equal(report.verification.tests.exitCode, 0);
      assert.equal(report.verification.hidden.exitCode, 0);
      if (selected.mode === "verify")
        assert.deepEqual(report.verification.paths, []);
    }
    if (caseId === "package-current")
      assert.deepEqual(report.verification.paths, ["src/report.js"]);
    if (caseId === "api-ahead")
      assert.equal(report.verification.paths.includes("src/report.js"), false);
  });
test("busy history and current requests keep coherent identities, original formatting and no model observations", async (t) => {
  const workspace = await createWorkspace({ caseId: "busy" });
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(workspace, "data", name)));
  const customers = read("customers.json"),
    invoices = read("settled-invoices.json"),
    request = read("request.json"),
    runs = read("formatting-runs.json");
  assert.equal(customers.length, 12);
  assert.equal(invoices.length, 36);
  assert.equal(request.invoices.length, 12);
  for (const invoice of invoices) {
    const customer = customers.find((c) => c.id === invoice.customerId);
    assert.equal(customer.currency, invoice.currency);
    assert.equal(
      invoice.rendered,
      `${invoice.id} | ${invoice.currency} ${(invoice.totalMinorUnits / 100).toFixed(2)}`,
    );
    assert.equal(invoice.formatkitVersion, "1.0.0");
    assert.equal(new Date(invoice.settledAt).toISOString(), invoice.settledAt);
    assert.equal(Object.hasOwn(invoice, "usage"), false);
  }
  for (const invoice of request.invoices)
    assert.equal(
      customers.find((c) => c.id === invoice.customerId).currency,
      invoice.currency,
    );
  assert.deepEqual(
    runs[0].invoiceIds,
    invoices.map((i) => i.id),
  );
  assert.equal(Object.hasOwn(runs[0], "model"), false);
  assert.equal(fs.existsSync(path.join(workspace, "grader")), false);
  assert.equal(fs.existsSync(path.join(workspace, "manifest.json")), false);
});
test("real key-free case CLI initializes all twelve private exclusive Git projects without an import cycle", async (t) => {
  const directory = root(t),
    script = fileURLToPath(new URL("../src/datasets.js", import.meta.url)),
    call = async (args) => {
      const result = await command(
        process.execPath,
        [script, ...args],
        directory,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      return result.stdout;
    };
  assert.match(await call(["--help"]), /Key-free/);
  assert.equal(fs.readdirSync(directory).length, 0);
  const rows = JSON.parse(await call(["list"]));
  assert.equal(rows.length, 12);
  assert.deepEqual(
    new Set(rows.map((r) => r.profile)),
    new Set(["starter", "busy", "ambiguous", "boundary"]),
  );
  for (const item of rows) {
    const target = path.join(directory, item.id),
      created = JSON.parse(
        await call(["init", item.id, "--directory", target]),
      );
    assert.equal(created.workspace, target);
    assert.equal(fs.statSync(target).mode & 0o777, 0o700);
    assert.equal(created.dataset.case_id, item.id);
    assert.match(created.baseline.commit, /^[a-f0-9]{40,64}$/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(target, ".dataset.json"))),
      {
        dataset_id: "formatkit-maintenance-cases",
        version: "1.0.0",
        case_id: item.id,
        profile: item.profile,
      },
    );
    assert.equal(fs.existsSync(path.join(target, "grader")), false);
  }
  const marker = path.join(directory, "upgrade", "marker");
  fs.writeFileSync(marker, "retain");
  const collision = await command(
    process.execPath,
    [script, "init", "upgrade", "--directory", path.join(directory, "upgrade")],
    directory,
  );
  assert.equal(collision.exitCode, 1);
  assert.equal(fs.readFileSync(marker, "utf8"), "retain");
  for (const args of [
    ["init", "../escape"],
    ["list", "extra"],
    [
      "init",
      "upgrade",
      "--directory",
      path.join(directory, "not-created"),
      "extra",
    ],
  ])
    assert.equal(
      (await command(process.execPath, [script, ...args], directory)).exitCode,
      1,
    );
  assert.equal(fs.existsSync(path.join(directory, "not-created")), false);
});
test("changed dataset bytes are rejected before target creation or SDK imports", async (t) => {
  const directory = root(t);
  fs.mkdirSync(path.join(directory, "src"));
  fs.copyFileSync(
    new URL("../src/datasets.js", import.meta.url),
    path.join(directory, "src/datasets.js"),
  );
  fs.cpSync(
    new URL("../datasets/", import.meta.url),
    path.join(directory, "datasets"),
    { recursive: true },
  );
  fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
  fs.appendFileSync(
    path.join(directory, "datasets/cases/upgrade/src/report.js"),
    "\n// corrupted\n",
  );
  const target = path.join(directory, "must-not-exist"),
    result = await command(
      process.execPath,
      ["src/datasets.js", "init", "upgrade", "--directory", target],
      directory,
    );
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Dataset file hash mismatch/);
  assert.equal(fs.existsSync(target), false);
});
test("clarification mode and original case identity cannot be replaced by application edits", async (t) => {
  const workspace = await createWorkspace({ caseId: "unclear-request" }),
    baseline = captureBaseline(workspace);
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  await minimalUpgrade(workspace);
  fs.writeFileSync(
    path.join(workspace, ".dataset.json"),
    JSON.stringify({
      dataset_id: "formatkit-maintenance-cases",
      version: "1.0.0",
      case_id: "upgrade",
      profile: "starter",
    }),
  );
  const checked = await verifyWorkspace(workspace, baseline);
  assert.equal(checked.passed, false);
  assert.ok(checked.invalidPaths.includes(".dataset.json"));
  assert.ok(checked.invalidPaths.includes("src/report.js"));
  assert.equal(checked.install, null);
  await assert.rejects(
    verifyWorkspace(workspace, baseline, { caseId: "upgrade" }),
    /Original maintenance case authority/,
  );
});
