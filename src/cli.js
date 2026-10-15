import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runMaintenance } from './maintenance.js';

const args = process.argv.slice(2);
const modelIndex = args.indexOf('--model');
const model = modelIndex < 0 ? undefined : args[modelIndex + 1];
const result = await runMaintenance({ model });
await mkdir('.runs', { recursive: true });
const reportPath = join('.runs', `report-${Date.now()}.json`);
await writeFile(reportPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  passed: result.passed,
  workspace: result.workspace,
  changedPaths: result.verification.paths,
  installExitCode: result.verification.install.exitCode,
  testExitCode: result.verification.tests?.exitCode,
  agentError: result.agentError,
  reportPath,
}, null, 2));
if (!result.passed) process.exitCode = 1;
