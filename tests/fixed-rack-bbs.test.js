import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyFixedRackMatch,
  averagePerformance,
  compareFixedRackPairingOrder,
  compareFixedRackStandings,
  expectedScore,
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
