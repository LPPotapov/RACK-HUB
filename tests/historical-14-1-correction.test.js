import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recordMatchResult } from '../src/application/tournamentCommands.js';
import { recalculateTournamentPlayers } from '../src/domain/tournamentRecalculation.js';
import { createApplicationState, createConfig, createTournamentState } from '../src/domain/tournamentModel.js';

// M2M-B historical 14.1 correction cross-check (Part 19): builds a
// representative stored history from the real vm-joes-14-1 fixture (Round 1
// seeded historically with Cross GBR / cross_elo — but this test, like the
// command itself, never calls pairing and does not care how the stored
// matchups were originally seeded; stored matchups are authoritative
// history), corrects one EARLIER (Round 1) result, and proves:
//   - the recalculated derived player metrics for the corrected match's two
//     participants change;
//   - every later round's stored matches (pairings, tables, targets, ids)
//     remain byte-for-byte unchanged — no pairing/re-pairing occurs.

const fixtureRoot = new URL('./fixtures/historical/vm-joes-14-1/', import.meta.url);
const load = async (file) => JSON.parse(await readFile(new URL(file, fixtureRoot), 'utf8'));

const buildRunningState = (roster, rounds, currentRound, config) => createApplicationState({
  tournament: createTournamentState({
    started: true,
    config,
    tournamentConfig: { title: '14.1 VM 2026', ...config },
    players: roster.map(({ id, name, elo }) => ({ id, name, elo })),
    roster,
    rounds,
    currentRound
  })
});

test('correcting an earlier (Round 1) historical 14.1 result changes derived metrics but leaves every later round structurally unchanged', async () => {
  const [players, matches] = await Promise.all([load('players.json'), load('matches.json')]);
  const roster = players.map((p, index) => ({ id: index, name: p.name, elo: p.startingGbr }));
  const idByName = new Map(roster.map((p) => [p.name, p.id]));

  const rounds = {};
  matches.forEach((m, index) => {
    rounds[m.round] = rounds[m.round] || [];
    rounds[m.round].push({
      id: `${m.round}-${index}`,
      p1: { id: idByName.get(m.playerA), elo: roster.find((p) => p.name === m.playerA).elo },
      p2: { id: idByName.get(m.playerB), elo: roster.find((p) => p.name === m.playerB).elo },
      r1: m.pointsA, r2: m.pointsB,
      done: true, cancelled: false, bye: false,
      format: 'straight_pool_14_1',
      target: m.exportedTarget,
      p1Points: m.pointsA, p2Points: m.pointsB,
      innings: m.innings, p1HighRun: m.highRunA, p2HighRun: m.highRunB,
      tbl: m.table
    });
  });
  const currentRound = Math.max(...matches.map((m) => m.round));
  const config = createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true } });

  const state = buildRunningState(roster, rounds, currentRound, config);

  const baseline = recalculateTournamentPlayers({
    players: state.tournament.players, roster, rounds: state.tournament.rounds, currentRound, config
  });

  // Correct the very first recorded Round 1 match (Richard Juros 30 - Leonid
  // Potapov 16) to a different, plausible result.
  const targetMatchId = rounds[1][0].id;
  const involvedIds = [rounds[1][0].p1.id, rounds[1][0].p2.id];

  const corrected = recordMatchResult(state, {
    roundNumber: 1, matchId: targetMatchId,
    p1Points: 20, p2Points: 30, innings: 10, p1HighRun: 6, p2HighRun: 10
  });

  // Derived metrics for the two involved players changed.
  involvedIds.forEach((id) => {
    const before = baseline.find((p) => p.id === id);
    const after = corrected.tournament.players.find((p) => p.id === id);
    assert.notEqual(before.mp, after.mp, `player ${id} mp should change`);
    assert.notEqual(before.elo, after.elo, `player ${id} elo should change`);
  });

  // The corrected match itself changed as expected.
  const correctedMatch = corrected.tournament.rounds[1].find((m) => m.id === targetMatchId);
  assert.equal(correctedMatch.p1Points, 20);
  assert.equal(correctedMatch.p2Points, 30);
  assert.equal(correctedMatch.done, true);
  // Structural fields on the corrected match itself are untouched.
  assert.deepEqual(correctedMatch.p1, rounds[1][0].p1);
  assert.deepEqual(correctedMatch.p2, rounds[1][0].p2);
  assert.equal(correctedMatch.tbl, rounds[1][0].tbl);
  assert.equal(correctedMatch.target, rounds[1][0].target);

  // Every OTHER Round 1 match is untouched.
  const otherRound1Matches = corrected.tournament.rounds[1].filter((m) => m.id !== targetMatchId);
  const originalOtherRound1Matches = rounds[1].filter((m) => m.id !== targetMatchId);
  assert.deepEqual(otherRound1Matches, originalOtherRound1Matches);

  // Every LATER round (2, 3, 4, 5) — pairings, tables, targets, ids, scores —
  // remains byte-for-byte identical. No pairing module was invoked.
  for (let round = 2; round <= currentRound; round++) {
    assert.deepEqual(corrected.tournament.rounds[round], rounds[round], `round ${round} must be structurally unchanged`);
  }
});
