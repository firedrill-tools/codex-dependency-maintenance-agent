import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createWorkspace,
  captureBaseline,
  verifyWorkspace,
  changedPaths,
} from "../src/maintenance.js";
import { command, succeeded } from "../src/commands.js";
import { upgrade } from "./helpers/upgrade.js";
async function fixture(t) {
  const workspace = await createWorkspace();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return workspace;
}
const cleanup = (t, result) => {
  if (result.checkDir)
    t.after(() => fs.rmSync(result.checkDir, { recursive: true, force: true }));
};

test("original trusted commit and filesystem facts expose a committed protected vendor edit", async (t) => {
  const workspace = await fixture(t),
    baseline = captureBaseline(workspace);
  fs.appendFileSync(
    path.join(workspace, "vendor/formatkit-v2/index.js"),
    "\n// protected edit\n",
  );
  assert.ok(succeeded(command("git", ["add", "."], workspace)));
  assert.ok(
    succeeded(
      command(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-qm",
          "hide vendor edit",
        ],
        workspace,
      ),
    ),
  );
  upgrade(workspace);
  const result = await verifyWorkspace(workspace);
  cleanup(t, result);
  assert.notEqual(
    command("git", ["rev-parse", "HEAD"], workspace).stdout.trim(),
    baseline.commit,
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.invalidPaths, ["vendor/formatkit-v2/index.js"]);
  assert.equal(result.install, null);
  assert.equal(result.checkDir, null);
});

test("allowed committed upgrade is still verified against original files and a fresh offline install", async (t) => {
  const workspace = await fixture(t);
  upgrade(workspace);
  assert.ok(succeeded(command("git", ["add", "."], workspace)));
  assert.ok(
    succeeded(
      command(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-qm",
          "allowed upgrade",
        ],
        workspace,
      ),
    ),
  );
  const result = await verifyWorkspace(workspace);
  cleanup(t, result);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.deepEqual(result.paths, [
    "package-lock.json",
    "package.json",
    "src/report.js",
  ]);
  assert.ok(succeeded(result.install));
});

for (const kind of [
  "ignored",
  "newline",
  "symlink",
  "hardlink",
  "protected-test",
  "directory-mode",
  "allowed-mode",
  "package-script",
])
  test(`${kind} scope change cannot reach validation execution`, async (t) => {
    const workspace = await fixture(t),
      outer = fs.mkdtempSync(path.join(os.tmpdir(), "deps-outside-")),
      marker = path.join(outer, "executed");
    t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
    upgrade(workspace);
    if (kind === "ignored") {
      fs.appendFileSync(
        path.join(workspace, ".git/info/exclude"),
        "\nprivate.txt\n",
      );
      fs.writeFileSync(path.join(workspace, "private.txt"), "unrelated");
    }
    if (kind === "newline")
      fs.writeFileSync(path.join(workspace, "notes\nprivate.txt"), "unrelated");
    if (kind === "symlink" || kind === "hardlink") {
      const file = path.join(workspace, "src/report.js"),
        external = path.join(outer, "report.js");
      fs.copyFileSync(file, external);
      fs.unlinkSync(file);
      if (kind === "symlink") fs.symlinkSync(external, file);
      else fs.linkSync(external, file);
    }
    if (kind === "protected-test")
      fs.appendFileSync(
        path.join(workspace, "test/report.test.js"),
        `\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');\n`,
      );
    if (kind === "directory-mode")
      fs.chmodSync(path.join(workspace, "docs"), 0o700);
    if (kind === "allowed-mode")
      fs.chmodSync(path.join(workspace, "src/report.js"), 0o755);
    if (kind === "package-script") {
      const file = path.join(workspace, "package.json"),
        pkg = JSON.parse(fs.readFileSync(file));
      pkg.scripts.postinstall = `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)},"executed")'`;
      fs.writeFileSync(file, JSON.stringify(pkg));
    }
    const result = await verifyWorkspace(workspace);
    cleanup(t, result);
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.equal(result.install, null);
    assert.equal(fs.existsSync(marker), false);
    if (kind === "package-script")
      assert.match(result.error.message, /Package intent/);
    else assert.ok(result.invalidPaths.length > 0);
    if (kind === "newline")
      assert.ok(result.invalidPaths.includes("notes\nprivate.txt"));
  });

test("direct Node command failure and output overflow cannot be successful gates", () => {
  const directory = process.cwd();
  const failed = command(
    process.execPath,
    ["-e", "process.exit(1)"],
    directory,
  );
  assert.equal(succeeded(failed), false);
  const overflow = command(
    process.execPath,
    ["-e", 'process.stdout.write("x".repeat(2000000))'],
    directory,
  );
  assert.ok(overflow.error);
  assert.equal(succeeded(overflow), false);
});

test("candidate change while the verifier prepares its isolated source invalidates the attempt", async (t) => {
  const workspace = await fixture(t);
  upgrade(workspace);
  const verification = verifyWorkspace(workspace),
    changed = new Promise((resolve) =>
      setImmediate(() => {
        fs.appendFileSync(
          path.join(workspace, "src/report.js"),
          "\n// changed during verification\n",
        );
        resolve();
      }),
    );
  const result = await verification;
  await changed;
  cleanup(t, result);
  assert.equal(result.passed, false);
  assert.match(result.error.message, /Candidate source changed/);
});

test("application self-modification in fresh tests is detected before external grader execution", async (t) => {
  const workspace = await fixture(t);
  upgrade(workspace);
  fs.appendFileSync(
    path.join(workspace, "src/report.js"),
    "\nimport fs from 'node:fs';fs.appendFileSync(new URL(import.meta.url),'\\n// self modification\\n');\n",
  );
  const result = await verifyWorkspace(workspace);
  cleanup(t, result);
  assert.equal(result.passed, false);
  assert.equal(result.hidden, null);
  assert.match(result.error.message, /Fresh validation source changed/);
});

test("external arbitrary checkout cannot invent a baseline from its current HEAD", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deps-foreign-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () => captureBaseline(directory),
    /Trusted original baseline required/,
  );
  assert.throws(
    () => changedPaths(directory),
    /Trusted original baseline required/,
  );
});

test("private umask does not change original modes inside a newly owned validation directory", async (t) => {
  const workspace = await fixture(t);
  upgrade(workspace);
  const before = process.umask(0o077);
  try {
    const result = await verifyWorkspace(workspace);
    cleanup(t, result);
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(fs.statSync(result.checkDir).mode & 0o777, 0o700);
  } finally {
    process.umask(before);
  }
});
