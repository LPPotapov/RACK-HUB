import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recalculateTournamentPlayers } from '../src/domain/tournamentRecalculation.js';
import { createConfig } from '../src/domain/tournamentModel.js';

// M2M-A historical 14.1 sanity (Part 17): replays the real vm-joes-14-1
// fixture through the pure full-history recalculation and cross-checks
// only the fields that are independently verifiable WITHOUT knowing the
// exact historical d/K/weight configuration (metadata.json's own
// `knownConfigurationUncertainty`/`NOT_TESTABLE` sections say those are not
// preserved) — match points, games, aggregate points for/against, and high
// run are all pure arithmetic over the recorded points/innings/high-run
// values, independent of any GBR/PERF weighting. GBR/PERF/RP are
// deliberately NOT cross-checked here; recalculating them requires
// configuration this fixture does not preserve. Pairings/rounds are read
// exactly as recorded — this test never re-derives or re-seeds them.

const fixtureRoot = new URL('./fixtures/historical/vm-joes-14-1/', import.meta.url);
const load = async (file) => JSON.parse(await readFile(new URL(file, fixtureRoot), 'utf8'));

test('historical 14.1 sanity: recalculated MP/games/pointsFor/pointsAgainst/highRun match the recorded final table for every player', async () => {
  const [players, matches, table] = await Promise.all([
    load('players.json'), load('matches.json'), load('expected-final-table.json')
  ]);

  const roster = players.map((p, index) => ({ id: index, name: p.name, elo: p.startingGbr }));
  const idByName = new Map(roster.map((p) => [p.name, p.id]));

  const rounds = {};
  matches.forEach((m, index) => {
    const round = m.round;
    rounds[round] = rounds[round] || [];
    rounds[round].push({
      id: `${round}-${index}`,
      p1: { id: idByName.get(m.playerA), elo: roster.find((p) => p.name === m.playerA).elo },
      p2: { id: idByName.get(m.playerB), elo: roster.find((p) => p.name === m.playerB).elo },
      r1: 0, r2: 0,
      done: true, cancelled: false, bye: false,
      format: 'straight_pool_14_1',
      target: m.exportedTarget,
      p1Points: m.pointsA, p2Points: m.pointsB,
      innings: m.innings, p1HighRun: m.highRunA, p2HighRun: m.highRunB,
      tbl: m.table
    });
  });
  const currentRound = Math.max(...matches.map((m) => m.round));
  assert.equal(currentRound, 5);

  const config = createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true } });
  const initialPlayers = roster.map(({ id, name, elo }) => ({ id, name, elo }));

  const recalced = recalculateTournamentPlayers({
    players: initialPlayers, roster, rounds, currentRound, config
  });

  for (const row of table) {
    const id = idByName.get(row.player);
    assert.notEqual(id, undefined, `no roster entry for ${row.player}`);
    const p = recalced.find((r) => r.id === id);

    assert.equal(p.mp, row.matchPoints, `${row.player} mp`);
    assert.equal(p.games, row.games, `${row.player} games`);
    assert.equal(p.pointsFor, row.pointsFor, `${row.player} pointsFor`);
    assert.equal(p.pointsAgainst, row.pointsAgainst, `${row.player} pointsAgainst`);
    assert.equal(p.hs, row.highRun, `${row.player} highRun`);
  }
});

test('historical 14.1 sanity: the two players with no recorded Round 5 match still have exactly 4 games (not 5)', async () => {
  const [players, matches, table] = await Promise.all([
    load('players.json'), load('matches.json'), load('expected-final-table.json')
  ]);
  const roster = players.map((p, index) => ({ id: index, name: p.name, elo: p.startingGbr }));
  const idByName = new Map(roster.map((p) => [p.name, p.id]));

  const playedRound5 = new Set();
  matches.filter((m) => m.round === 5).forEach((m) => { playedRound5.add(m.playerA); playedRound5.add(m.playerB); });
  const missingRound5 = players.map((p) => p.name).filter((name) => !playedRound5.has(name));
  assert.equal(missingRound5.length, 2);

  const rounds = {};
  matches.forEach((m, index) => {
    rounds[m.round] = rounds[m.round] || [];
    rounds[m.round].push({
      id: `${m.round}-${index}`,
      p1: { id: idByName.get(m.playerA) }, p2: { id: idByName.get(m.playerB) },
      r1: 0, r2: 0, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1',
      target: m.exportedTarget, p1Points: m.pointsA, p2Points: m.pointsB,
      innings: m.innings, p1HighRun: m.highRunA, p2HighRun: m.highRunB
    });
  });

  const config = createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true } });
  const recalced = recalculateTournamentPlayers({
    players: roster.map(({ id, name, elo }) => ({ id, name, elo })), roster, rounds, currentRound: 5, config
  });

  missingRound5.forEach((name) => {
    const p = recalced.find((r) => r.id === idByName.get(name));
    const expectedGames = table.find((row) => row.player === name).games;
    assert.equal(p.games, 4);
    assert.equal(p.games, expectedGames);
  });
});
