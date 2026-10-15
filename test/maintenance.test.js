import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createWorkspace, runMaintenance, verifyWorkspace } from '../src/maintenance.js';

async function scriptedUpgrade(workspace) {
  const packagePath = join(workspace, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.dependencies.formatkit = 'file:vendor/formatkit-v2';
  await writeFile(packagePath, JSON.stringify(pkg, null, 2));
  const sourcePath = join(workspace, 'src/report.js');
  let source = await readFile(sourcePath, 'utf8');
  source = source.replace("import { formatMoney }", "import { formatCurrency }")
    .replace('formatMoney(totalMinorUnits, currency)', 'formatCurrency({ minorUnits: totalMinorUnits, currency })');
  await writeFile(sourcePath, source);
  execFileSync('npm', ['install', '--offline'], { cwd: workspace, stdio: 'pipe' });
}

test('baseline installs cleanly but JPY test fails', async () => {
  const workspace = await createWorkspace();
  const report = await verifyWorkspace(workspace);
  assert.equal(report.install.exitCode, 0);
  assert.equal(report.tests.exitCode, 1);
  assert.equal(report.passed, false);
});

test('upgraded app, lockfile and hidden checks pass from a fresh install', async () => {
  const result = await runMaintenance({ agent: async workspace => {
    await scriptedUpgrade(workspace);
    return { finalResponse: 'Scripted upgrade for harness test' };
  } });
  assert.equal(result.passed, true, JSON.stringify(result.verification));
  assert.deepEqual(result.verification.paths, ['package-lock.json', 'package.json', 'src/report.js']);
});

test('stale lockfile is rejected by npm ci', async () => {
  const workspace = await createWorkspace();
  const packagePath = join(workspace, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.dependencies.formatkit = 'file:vendor/formatkit-v2';
  await writeFile(packagePath, JSON.stringify(pkg));
  const verification = await verifyWorkspace(workspace);
  assert.equal(verification.passed, false);
  assert.notEqual(verification.install.exitCode, 0);
});

test('vendor edits violate the scope even when the upgrade works', async () => {
  const workspace = await createWorkspace();
  await scriptedUpgrade(workspace);
  const vendorPath = join(workspace, 'vendor/formatkit-v2/index.js');
  await writeFile(vendorPath, (await readFile(vendorPath, 'utf8')) + '\n// unrelated edit\n');
  const verification = await verifyWorkspace(workspace);
  assert.equal(verification.passed, false);
  assert.deepEqual(verification.invalidPaths, ['vendor/formatkit-v2/index.js']);
});
