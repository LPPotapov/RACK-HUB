import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManualTableList, parseTableCsv, tableLabels } from '../src/application/canalettoTables.js';

const BILLARDPAD_CSV = [
  'order,table,id,score_link',
  '1,301 TV,KO40QM2MNDMD,https://billardpad.example/1',
  '2,302,6CSGGODKAFBJ,https://billardpad.example/2',
  '3,303,ABC123,https://billardpad.example/3'
].join('\n');

test('parseTableCsv performs a full parse of the BillardPad export format', () => {
  const tables = parseTableCsv(BILLARDPAD_CSV);
  assert.equal(tables.length, 3);
  assert.deepEqual(tables[0], { order: 1, label: '301 TV', billardPadId: 'KO40QM2MNDMD', scoreLink: 'https://billardpad.example/1' });
});

test('parseTableCsv preserves file row order and never sorts', () => {
  const shuffled = [
    'order,table,id,score_link',
    '3,303,X3,https://x/3',
    '1,301 TV,X1,https://x/1',
    '2,302,X2,https://x/2'
  ].join('\n');
  const tables = parseTableCsv(shuffled);
  // Row sequence is preserved (303, 301 TV, 302) — the file's OWN "order"
  // column is not used to re-sort; `order` is stamped from row position.
  assert.deepEqual(tableLabels(tables), ['303', '301 TV', '302']);
  assert.deepEqual(tables.map((t) => t.order), [1, 2, 3]);
});

test('parseTableCsv: `label` is the only value the canonical BBS layer needs (tableLabels)', () => {
  const tables = parseTableCsv(BILLARDPAD_CSV);
  assert.deepEqual(tableLabels(tables), ['301 TV', '302', '303']);
});

test('parseTableCsv preserves BillardPad id/score_link metadata', () => {
  const tables = parseTableCsv(BILLARDPAD_CSV);
  assert.equal(tables[1].billardPadId, '6CSGGODKAFBJ');
  assert.equal(tables[1].scoreLink, 'https://billardpad.example/2');
});

test('parseTableCsv tolerates rows with missing metadata columns', () => {
  const csv = 'order,table,id,score_link\n1,401,,\n2,402';
  const tables = parseTableCsv(csv);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].billardPadId, null);
  assert.equal(tables[1].scoreLink, null);
});

test('parseTableCsv works without a header row too', () => {
  const csv = '1,501,ID1,https://x/1\n2,502,ID2,https://x/2';
  const tables = parseTableCsv(csv);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].label, '501');
});

test('alphanumeric table labels are preserved verbatim, never coerced to numbers', () => {
  const tables = parseTableCsv(BILLARDPAD_CSV);
  assert.equal(tables[0].label, '301 TV');
  assert.equal(typeof tables[0].label, 'string');
});

test('parseManualTableList: one label per line, order preserved, no metadata', () => {
  const tables = parseManualTableList('301 TV\n302\n\n303\n');
  assert.deepEqual(tableLabels(tables), ['301 TV', '302', '303']);
  assert.deepEqual(tables.map((t) => t.order), [1, 2, 3]);
  tables.forEach((t) => {
    assert.equal(t.billardPadId, null);
    assert.equal(t.scoreLink, null);
  });
});

test('the exact current Canaletto table list preserves its given order end to end', () => {
  const labels = ['301 TV', '302', '303', '304', '405', '404', '403', '402', '401', '507', '506', '505', '504', '503', '502', '501'];
  const tables = parseManualTableList(labels.join('\n'));
  assert.deepEqual(tableLabels(tables), labels);
});
