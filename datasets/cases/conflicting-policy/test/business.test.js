import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {renderInvoice} from '../src/report.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url)));
test('fictional source references and settled format history remain coherent',()=>{const customers=read('customers.json'),invoices=read('settled-invoices.json'),runs=read('formatting-runs.json');assert.equal(new Set(customers.map(c=>c.id)).size,customers.length);for(const invoice of invoices){assert.ok(customers.some(c=>c.id===invoice.customerId));assert.equal(invoice.rendered,invoice.id+' | '+invoice.currency+' '+(invoice.totalMinorUnits/100).toFixed(2));assert.equal(invoice.status,'settled');}assert.deepEqual(runs[0].invoiceIds,invoices.map(i=>i.id));});
test('current request uses declared minor units for each supported currency',()=>{for(const invoice of read('request.json').invoices){const scale=invoice.currency==='JPY'?1:100,digits=invoice.currency==='JPY'?0:2;assert.equal(renderInvoice(invoice),invoice.id+' | '+invoice.currency+' '+(invoice.totalMinorUnits/scale).toFixed(digits));}});
