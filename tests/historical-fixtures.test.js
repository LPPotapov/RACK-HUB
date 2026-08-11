import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureRoot = new URL('./fixtures/historical/', import.meta.url);
const load = async (event, file) => JSON.parse(await readFile(new URL(`${event}/${file}`, fixtureRoot), 'utf8'));

const numericRoundTotal = (roundResults) => Object.values(roundResults)
  .filter((value) => typeof value === 'number')
  .reduce((sum, value) => sum + value, 0);

const assertGbrArithmetic = (rows) => {
  for (const row of rows) assert.equal(row.startingGbr + row.gbrChange, row.finalGbr, row.player);
};

test('14.1 fixture preserves player, match, and aggregate invariants', async () => {
  const [metadata, players, matches, table] = await Promise.all([
    load('vm-joes-14-1', 'metadata.json'), load('vm-joes-14-1', 'players.json'),
    load('vm-joes-14-1', 'matches.json'), load('vm-joes-14-1', 'expected-final-table.json')
  ]);
  assert.equal(players.length, 10);
  assert.equal(table.length, 10);
  assert.equal(matches.length, 24);
  assert.equal(metadata.recordedMatchCount, 24);
  assertGbrArithmetic(table);
  for (const row of table) {
    assert.equal(row.pointsFor - row.pointsAgainst, row.pointDifferential, row.player);
    const exportedMp = Object.values(row.roundResults).filter((v) => v !== '-').reduce((sum, value) => sum + Number.parseFloat(value), 0);
    assert.equal(exportedMp, row.matchPoints, row.player);
  }
  for (const match of matches) {
    assert.equal(match.actualTarget, null);
    assert.equal(match.actualTargetSource, null);
    assert.equal(match.historicalGbrA.change, -match.historicalGbrB.change);
  }
  assert.equal(matches.find((m) => m.round === 5 && m.table === '301').exportedTarget, 20);
  assert.equal(table[0].player, 'Paul Weißbach');
  assert.equal(table[0].finalPerf, 1866);
});

for (const [event, expectedPlayers, representative] of [
  ['vm-joes-9-ball', 22, { player: 'Richard Juros', averagePerf: 1777 }],
  ['vm-joes-10-ball', 19, { player: 'Maik Schlegel', averagePerf: 1765 }]
]) {
  test(`${event} fixture preserves final-table invariants`, async () => {
    const rows = await load(event, 'expected-final-table.json');
    assert.equal(rows.length, expectedPlayers);
    assertGbrArithmetic(rows);
    for (const row of rows) {
      assert.equal(row.racksWon - row.racksLost, row.rackDifferential, row.player);
      assert.equal(numericRoundTotal(row.roundResults), row.matchPoints, row.player);
    }
    assert.equal(rows[0].player, representative.player);
    assert.equal(rows[0].averagePerf, representative.averagePerf);
  });
}
