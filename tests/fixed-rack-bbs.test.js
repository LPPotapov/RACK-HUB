import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyFixedRackMatch,
  averagePerformance,
  compareFixedRackPairingOrder,
  compareFixedRackStandings,
  expectedScore,
  fixedRackMatchOutcome,
  gbrChange,
  initialReplayPlayer,
  matchPoints,
  pairingCost,
  performanceGbr,
  replayFixedRackHistory,
  selectEligibleBye
} from '../src/domain/fixedRackBbs.js';

const config = { d: 330, k_m: 30, k_r: 20 };
const closeTo = (actual, expected, epsilon = 1e-12) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const player = (id, overrides = {}) => ({ id, mp: 0, perf: 0, perfCount: 0, elo: 1500, racksWon: 0, racksLost: 0, opps: [], ...overrides });

test('expected score follows the d=330 logistic reference cases', () => {
  assert.equal(expectedScore(1600, 1600, 330), 0.5);
  closeTo(expectedScore(1700, 1370, 330), 10 / 11);
  closeTo(expectedScore(1700, 1500, 330) + expectedScore(1500, 1700, 330), 1);
});

test('GBR update covers results, margins, zero-sum application, and empty scores', () => {
  closeTo(gbrChange(1600, 1600, 5, 1, config), 65 / 3);
  closeTo(gbrChange(1600, 1600, 4, 2, config), 55 / 3);
  assert.equal(gbrChange(1600, 1600, 3, 3, config), 0);
  closeTo(gbrChange(1600, 1600, 1, 5, config), -65 / 3);
  assert.equal(gbrChange(1600, 1600, 0, 0, config), 0);

  const before = [initialReplayPlayer(player(1, { elo: 1700 })), initialReplayPlayer(player(2, { elo: 1500 }))];
  const after = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 2 }, r1: 4, r2: 2, done: true, cancelled: false }, config);
  closeTo(after[0].elo + after[1].elo, 3200);
  closeTo(after[0].elo - before[0].elo, -(after[1].elo - before[1].elo));
  assert.equal(after[0].perf, performanceGbr(1500, 4, 2, 330));
  assert.equal(after[1].perf, performanceGbr(1700, 2, 4, 330));
});

test('PERF uses opponent pre-match GBR, caps extremes, rounds matches, and averages', () => {
  assert.equal(performanceGbr(1750, 4, 2, 330), 1849);
  assert.equal(performanceGbr(1700, 6, 0, 330), 2690);
  assert.equal(performanceGbr(1700, 0, 6, 330), 710);
  assert.equal(performanceGbr(1700, 0, 0, 330), 1700);
  const performances = [performanceGbr(1750, 4, 2, 330), performanceGbr(1650, 2, 4, 330), performanceGbr(1800, 5, 1, 330)];
  assert.deepEqual(performances, [1849, 1551, 2031]);
  closeTo(averagePerformance(performances.reduce((a, b) => a + b, 0), performances.length), 1810 + 1 / 3);
});

test('match points and bye statistical effects are stable', () => {
  assert.equal(matchPoints(4, 2), 1);
  assert.equal(matchPoints(3, 3), 0.5);
  assert.equal(matchPoints(2, 4), 0);
  assert.equal(matchPoints(0, 0, true), 1);
  const before = [initialReplayPlayer(player(1, { elo: 1500 }))];
  const after = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 'bye' }, r1: 0, r2: 0, done: true, bye: true }, config);
  assert.deepEqual({ mp: after[0].mp, games: after[0].games, racksWon: after[0].racksWon, racksLost: after[0].racksLost, perf: after[0].perf, perfCount: after[0].perfCount, elo: after[0].elo },
    { mp: 1, games: 1, racksWon: 0, racksLost: 0, perf: 0, perfCount: 0, elo: 1500 });
});

test('fixedRackMatchOutcome computes MP/GBR-change/PERF from explicit pre-match GBR snapshots (no player lookup)', () => {
  const outcome = fixedRackMatchOutcome(4, 2, 1600, 1600, config);
  assert.equal(outcome.mpA, 1);
  assert.equal(outcome.mpB, 0);
  closeTo(outcome.change, 55 / 3);
  assert.equal(outcome.perfA, 1699);
  assert.equal(outcome.perfB, 1501);

  // Matches applyFixedRackMatch's result for the same inputs (single canonical formula).
  const before = [initialReplayPlayer(player(1, { elo: 1600 })), initialReplayPlayer(player(2, { elo: 1600 }))];
  const after = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 2 }, r1: 4, r2: 2, done: true, cancelled: false }, config);
  closeTo(after[0].elo - before[0].elo, outcome.change);
  assert.equal(after[0].perf, outcome.perfA);
  assert.equal(after[1].perf, outcome.perfB);
});

test('applyFixedRackMatch accumulates racksWon/racksLost and opponent history, without duplicating a repeat opponent', () => {
  const before = [initialReplayPlayer(player(1, { elo: 1600 })), initialReplayPlayer(player(2, { elo: 1600 }))];
  const after = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 2 }, r1: 4, r2: 2, done: true, cancelled: false }, config);
  assert.deepEqual({ racksWon: after[0].racksWon, racksLost: after[0].racksLost, opps: after[0].opps }, { racksWon: 4, racksLost: 2, opps: [2] });
  assert.deepEqual({ racksWon: after[1].racksWon, racksLost: after[1].racksLost, opps: after[1].opps }, { racksWon: 2, racksLost: 4, opps: [1] });

  // A rematch against the same opponent accumulates racks again but does not duplicate the opps entry.
  const rematch = applyFixedRackMatch(after, { p1: { id: 1 }, p2: { id: 2 }, r1: 3, r2: 3, done: true, cancelled: false }, config);
  assert.deepEqual({ racksWon: rematch[0].racksWon, racksLost: rematch[0].racksLost, opps: rematch[0].opps }, { racksWon: 7, racksLost: 5, opps: [2] });
  assert.deepEqual({ racksWon: rematch[1].racksWon, racksLost: rematch[1].racksLost, opps: rematch[1].opps }, { racksWon: 5, racksLost: 7, opps: [1] });
});

test('applyFixedRackMatch and bye both route RP accrual through calculatePrestige, with the opponent receiving the negated GBR change', () => {
  const prestige = (mp, change) => mp * 10 + change;
  const before = [initialReplayPlayer(player(1, { elo: 1600 })), initialReplayPlayer(player(2, { elo: 1600 }))];
  const after = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 2 }, r1: 4, r2: 2, done: true, cancelled: false }, config, prestige);
  const change = after[0].elo - before[0].elo;
  closeTo(after[0].rp, 1 * 10 + change); // mpA = 1 (won)
  closeTo(after[1].rp, 0 * 10 + (-change)); // mpB = 0 (lost), sees the negated change

  const byeBefore = [initialReplayPlayer(player(1, { elo: 1500 }))];
  const byeAfter = applyFixedRackMatch(byeBefore, { p1: { id: 1 }, p2: { id: 'bye' }, r1: 0, r2: 0, done: true, bye: true }, config, prestige);
  assert.equal(byeAfter[0].rp, 1 * 10 + 0); // bye: mp = 1, GBR change = 0

  // Without a calculatePrestige argument, rp defaults to 0 (existing default behavior).
  const withoutPrestige = applyFixedRackMatch(before, { p1: { id: 1 }, p2: { id: 2 }, r1: 4, r2: 2, done: true, cancelled: false }, config);
  assert.equal(withoutPrestige[0].rp, 0);
  assert.equal(withoutPrestige[1].rp, 0);
});

test('synthetic fixture: round-by-round snapshots after Round 1 and after Round 2', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/fixed-rack-reference/synthetic-replay.json', import.meta.url), 'utf8'));
  const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));

  // "Before Round 2" is equivalent to "after Round 1" (only completed rounds < 2 replayed).
  const afterRound1 = byId(replayFixedRackHistory(fixture.players, { 1: fixture.rounds['1'] }, fixture.config));
  closeTo(afterRound1[1].elo, 1713.2821962575558);
  closeTo(afterRound1[2].elo, 1586.7178037424442);
  closeTo(afterRound1[3].elo, 1491.6155295908893);
  closeTo(afterRound1[4].elo, 1408.3844704091107);
  assert.deepEqual([afterRound1[1].mp, afterRound1[2].mp, afterRound1[3].mp, afterRound1[4].mp], [1, 0, 0.5, 0.5]);
  assert.deepEqual([afterRound1[1].games, afterRound1[2].games, afterRound1[3].games, afterRound1[4].games], [1, 1, 1, 1]);
  assert.deepEqual([afterRound1[1].perf, afterRound1[2].perf, afterRound1[3].perf, afterRound1[4].perf], [1831, 1469, 1400, 1500]);
  assert.deepEqual(afterRound1[1].opps, [2]);
  assert.deepEqual(afterRound1[3].opps, [4]);
  // The cancelled (1v3) and incomplete (2v4) Round 1 matches must not appear in opponent history.
  assert.equal(afterRound1[1].opps.includes(3), false);
  assert.equal(afterRound1[2].opps.includes(4), false);

  const afterRound2 = byId(replayFixedRackHistory(fixture.players, fixture.rounds, fixture.config));
  closeTo(afterRound2[1].elo, 1675.2718085420506);
  closeTo(afterRound2[2].elo, 1597.0479416625346);
  closeTo(afterRound2[3].elo, 1481.2853916707988);
  closeTo(afterRound2[4].elo, 1446.394858124616);
  assert.deepEqual([afterRound2[1].racksWon, afterRound2[2].racksWon, afterRound2[3].racksWon, afterRound2[4].racksWon], [7, 5, 5, 7]);
  assert.deepEqual([afterRound2[1].racksLost, afterRound2[2].racksLost, afterRound2[3].racksLost, afterRound2[4].racksLost], [5, 7, 7, 5]);
  assert.deepEqual(afterRound2[1].opps, [2, 4]);
  assert.deepEqual(afterRound2[2].opps, [1, 3]);
  assert.deepEqual(afterRound2[3].opps, [4, 2]);
  assert.deepEqual(afterRound2[4].opps, [3, 1]);
});

test('standings: Classic is strict MP -> PERF -> ID; Rack stays MP -> RD -> PERF -> ID', () => {
  // Classic: more MP always ranks above less MP, regardless of an extreme PERF gap.
  const oneMp = player(1, { mp: 1, perf: 0, perfCount: 1 });
  const extremePerf = player(2, { mp: 0, perf: 20000, perfCount: 1 });
  assert.deepEqual([extremePerf, oneMp].sort((a, b) => compareFixedRackStandings(a, b, 'classic')).map((p) => p.id), [1, 2]);

  // Classic: equal MP is resolved by average PERF.
  const lowPerf = player(1, { mp: 2, perf: 1600, perfCount: 1 });
  const highPerf = player(2, { mp: 2, perf: 1700, perfCount: 1 });
  assert.deepEqual([lowPerf, highPerf].sort((a, b) => compareFixedRackStandings(a, b, 'classic')).map((p) => p.id), [2, 1]);

  // Classic: equal MP and equal PERF is resolved deterministically by ID.
  assert.deepEqual([player(2), player(1)].sort((a, b) => compareFixedRackStandings(a, b, 'classic')).map((p) => p.id), [1, 2]);

  // Rack Differential mode is unchanged: MP -> Rack Differential -> PERF -> ID.
  const betterRd = player(1, { mp: 2, perf: 1600, perfCount: 1, racksWon: 13, racksLost: 12 });
  const worseRd = player(2, { mp: 2, perf: 1700, perfCount: 1, racksWon: 10, racksLost: 10 });
  assert.deepEqual([betterRd, worseRd].sort((a, b) => compareFixedRackStandings(a, b, 'racks')).map((p) => p.id), [1, 2]);
  const higherMp = player(3, { mp: 2, perf: 1500, perfCount: 1 });
  const lowerMpBigPerf = player(4, { mp: 1, perf: 2500, perfCount: 1 });
  assert.deepEqual([lowerMpBigPerf, higherMp].sort((a, b) => compareFixedRackStandings(a, b, 'racks')).map((p) => p.id), [3, 4]);
});

test('standard pairing order and cost exclude rack differential and remain deterministic', () => {
  const a = player(1, { mp: 2, perf: 1500, perfCount: 1, racksWon: 1, racksLost: 20 });
  const b = player(2, { mp: 2, perf: 1600, perfCount: 1, racksWon: 20, racksLost: 1 });
  const c = player(3, { mp: 1, perf: 5000, perfCount: 1 });
  assert.deepEqual([a, b, c].sort(compareFixedRackPairingOrder).map((p) => p.id), [2, 1, 3]);
  assert.deepEqual([player(2), player(1)].sort(compareFixedRackPairingOrder).map((p) => p.id), [1, 2]);
  assert.equal(pairingCost(player(1, { mp: 2, elo: 1500 }), player(2, { mp: 2, elo: 1600 })), 100);
  assert.equal(pairingCost(player(1, { mp: 2, elo: 1500, opps: [2] }), player(2, { mp: 2, elo: 1600 })), 100100);
  const anchor = player(1, { mp: 2, avgPerf: 1500 });
  const sameMpLargePerfGap = player(4, { mp: 2, avgPerf: 10500 });
  const oneMpGap = player(5, { mp: 1, avgPerf: 1500 });
  assert.equal(pairingCost(anchor, sameMpLargePerfGap), 9000);
  assert.equal(pairingCost(anchor, oneMpGap), 10000);
});

test('bye selection chooses the lowest eligible player and protects prior/new byes', () => {
  const sorted = [player(1), player(2), player(3), player(4), player(5)];
  assert.equal(selectEligibleBye(sorted, new Set(), new Set()).id, 5);
  assert.equal(selectEligibleBye(sorted, new Set([5]), new Set([4])).id, 3);
  assert.equal(selectEligibleBye(sorted, new Set([1, 2, 3, 5]), new Set([4])), null);
});

test('synthetic history replay resets, follows stored order, ignores invalid matches, and is idempotent', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/fixed-rack-reference/synthetic-replay.json', import.meta.url), 'utf8'));
  const first = replayFixedRackHistory(fixture.players, fixture.rounds, fixture.config);
  const second = replayFixedRackHistory(first, fixture.rounds, fixture.config);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map((p) => p.games), [2, 2, 2, 2]);
  assert.deepEqual(first.map((p) => p.perfCount), [2, 2, 2, 2]);
  assert.deepEqual(first.map((p) => p.mp), [1, 1, 0.5, 1.5]);
  closeTo(first.reduce((sum, p) => sum + p.elo, 0), 6200);

  const reversedRounds = { 1: fixture.rounds[2], 2: fixture.rounds[1] };
  const reordered = replayFixedRackHistory(fixture.players, reversedRounds, fixture.config);
  assert.notDeepEqual(reordered.map((p) => p.elo), first.map((p) => p.elo));

  const edited = structuredClone(fixture);
  edited.rounds[1][0].r1 = 1;
  edited.rounds[1][0].r2 = 5;
  const recalculated = replayFixedRackHistory(edited.players, edited.rounds, edited.config);
  assert.notDeepEqual(recalculated.map((p) => p.elo), first.map((p) => p.elo));
  assert.notDeepEqual(recalculated.map((p) => p.perf), first.map((p) => p.perf));
});
