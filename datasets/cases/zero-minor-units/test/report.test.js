import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInvoice } from '../src/report.js';

test('formats USD invoice', () => {
  assert.equal(renderInvoice({ id: 'INV-7', totalMinorUnits: 1250, currency: 'USD' }), 'INV-7 | USD 12.50');
});

test('JPY uses zero-decimal minor units', () => {
  assert.equal(renderInvoice({ id: 'INV-8', totalMinorUnits: 1200, currency: 'JPY' }), 'INV-8 | JPY 1200');
});
