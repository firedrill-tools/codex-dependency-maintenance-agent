import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('workspace required');
const pkg = JSON.parse(await readFile(resolve(workspace, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(workspace, 'package-lock.json'), 'utf8'));
assert.equal(pkg.dependencies.formatkit, 'file:vendor/formatkit-v2');
assert.equal(lock.packages[''].dependencies.formatkit, 'file:vendor/formatkit-v2');
assert.equal(lock.packages['node_modules/formatkit'].resolved, 'vendor/formatkit-v2');
assert.equal(lock.packages['vendor/formatkit-v2'].version, '2.0.0');
const { renderInvoice } = await import(pathToFileURL(resolve(workspace, 'src/report.js')).href);
assert.equal(renderInvoice({ id: 'INV-CAD', totalMinorUnits: 981, currency: 'CAD' }), 'INV-CAD | CAD 9.81');
assert.equal(renderInvoice({ id: 'INV-JPY', totalMinorUnits: 1200, currency: 'JPY' }), 'INV-JPY | JPY 1200');
assert.throws(() => renderInvoice({ id: '', totalMinorUnits: 100, currency: 'USD' }), /invoice id/);
assert.throws(() => renderInvoice({ id: 'INV-X', totalMinorUnits: -1, currency: 'USD' }), /invalid minor units/);
console.log('Dependency and hidden behavior checks passed');
