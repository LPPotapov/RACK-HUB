import assert from 'node:assert/strict';
import test from 'node:test';
import { gbrChange, matchPoints, performanceGbr } from '../src/domain/fixedRackBbs.js';
import { recalculateTournamentPlayers } from '../src/domain/tournamentRecalculation.js';
import { reconstructStandingsBeforeRound } from '../src/domain/beforeRoundStandings.js';
import { straightPoolMatchOutcome } from '../src/domain/straightPool14_1.js';
import { createConfig } from '../src/domain/tournamentModel.js';

const fixedConfig = (overrides = {}) => createConfig(overrides);
const spConfig = (overrides = {}) => createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true }, ...overrides });

const roster = (entries) => entries.map(([id, name, elo]) => ({ id, name, elo }));
const player = (id, name, elo) => ({ id, name, elo });

const rpFormula = (mp, eloChange, config) => {
  if (!config.use_rp) return 0;
  return config.rp_per_round + mp * config.rp_per_mp + (eloChange > 0 ? eloChange * config.rp_elo_multiplier : 0);
};

// =============================================================================
// 1. Empty history
// =============================================================================

test('1: empty history (currentRound: 0) resets players to the steady-state zero shape at their roster starting GBR', () => {
  const players = [player(1, 'Alpha', 1650), player(2, 'Bravo', 1520)]; // stale/current elo, ignored
  const result = recalculateTournamentPlayers({
    players,
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: {},
    currentRound: 0,
    config: fixedConfig()
  });

  assert.equal(result[0].elo, 1600);
  assert.equal(result[1].elo, 1500);
  result.forEach((p) => {
    assert.equal(p.mp, 0);
    assert.equal(p.games, 0);
    assert.deepEqual(p.opps, []);
  });
});

// =============================================================================
// 2-5. Fixed-rack
// =============================================================================

test('2: a single completed fixed-rack match computes MP/racks/PERF/GBR/games/opps/RP exactly via the shared domain formulas', () => {
  const config = fixedConfig();
  const p1 = player(1, 'Alpha', 1600);
  const p2 = player(2, 'Bravo', 1500);
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' };

  const result = recalculateTournamentPlayers({
    players: [p1, p2], roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });

  const expChange = gbrChange(1600, 1500, 4, 2, config);
  const expMpA = matchPoints(4, 2);
  const expPerfA = performanceGbr(1500, 4, 2, config.d);
  const a = result.find((p) => p.id === 1);
  const b = result.find((p) => p.id === 2);

  assert.equal(a.mp, expMpA);
  assert.equal(a.racksWon, 4);
  assert.equal(a.racksLost, 2);
  assert.equal(a.perf, expPerfA);
  assert.equal(a.perfCount, 1);
  assert.equal(a.elo, 1600 + expChange);
  assert.equal(a.games, 1);
  assert.deepEqual(a.opps, [2]);
  assert.equal(a.rp, rpFormula(expMpA, expChange, config));

  assert.equal(b.elo, 1500 - expChange);
  assert.equal(b.racksWon, 2);
  assert.equal(b.racksLost, 4);
});

test('3/4: multiple sequential fixed-rack rounds evolve GBR sequentially, not from a single final computation', () => {
  const config = fixedConfig();
  const players = [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)];
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    2: [{ id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }]
  };

  const result = recalculateTournamentPlayers({ players, roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]), rounds, currentRound: 2, config });

  // Manually replay: round 1 changes GBR, round 2 must use round-1's UPDATED GBR, not 1600/1500 again.
  const change1 = gbrChange(1600, 1500, 4, 2, config);
  const eloAfterR1_A = 1600 + change1;
  const eloAfterR1_B = 1500 - change1;
  const change2 = gbrChange(eloAfterR1_A, eloAfterR1_B, 3, 3, config);
  const expectedFinalA = eloAfterR1_A + change2;
  const expectedFinalB = eloAfterR1_B - change2;

  const a = result.find((p) => p.id === 1);
  const b = result.find((p) => p.id === 2);
  assert.equal(a.elo, expectedFinalA);
  assert.equal(b.elo, expectedFinalB);
  assert.equal(a.games, 2);
  assert.equal(a.mp, matchPoints(4, 2) + matchPoints(3, 3));

  // Sanity: a NON-sequential (bug) implementation would compute round 2's
  // change from the ORIGINAL 1600/1500 GBR instead of round 1's result —
  // prove that would give a different (wrong) final value.
  const wrongChange2 = gbrChange(1600, 1500, 3, 3, config);
  const wrongFinalA = 1600 + change1 + wrongChange2;
  assert.notEqual(expectedFinalA, wrongFinalA);
});

test('5: a format-less match (Manual Pairing Editor shape) is treated as fixed-rack', () => {
  const config = fixedConfig();
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false }; // no format key
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.racksWon, 4); // fixed-rack accrual happened, not skipped
});

// =============================================================================
// 6-8. 14.1
// =============================================================================

test('6: a single completed 14.1 match computes points/innings/NPD/HS/HGD/PERF/GBR/RP via the shared domain formula', () => {
  const config = spConfig();
  const sp = { ...config.straightPool };
  const match = {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, done: true, cancelled: false, bye: false,
    format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
  };

  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1700), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1700], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });

  const outcome = straightPoolMatchOutcome(1700, 1500, { p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: 30 }, { d: config.d, k_m: config.k_m, sp });

  const a = result.find((p) => p.id === 1);
  assert.equal(a.mp, outcome.mpA);
  assert.equal(a.perf, outcome.perfA);
  assert.equal(a.perfCount, 1);
  assert.equal(a.elo, 1700 + outcome.change);
  assert.equal(a.pointsFor, 30);
  assert.equal(a.pointsAgainst, 16);
  assert.equal(a.inningsTotal, 9);
  assert.equal(a.npd, outcome.npdA);
  assert.equal(a.hs, 9);
  assert.equal(a.hgd, outcome.gdA);
  assert.equal(a.rp, rpFormula(outcome.mpA, outcome.change, config));
  assert.deepEqual(a.opps, [2]);
});

test('7: multiple 14.1 rounds evolve GBR sequentially', () => {
  const config = spConfig();
  const sp = { ...config.straightPool };
  const rounds = {
    1: [{ id: 1, p1: { id: 1 }, p2: { id: 2 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 10, innings: 8, p1HighRun: 8, p2HighRun: 3 }],
    2: [{ id: 2, p1: { id: 1 }, p2: { id: 2 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', target: 40, p1Points: 20, p2Points: 40, innings: 10, p1HighRun: 5, p2HighRun: 12 }]
  };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1700), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1700], [2, 'Bravo', 1500]]),
    rounds, currentRound: 2, config
  });

  const outcome1 = straightPoolMatchOutcome(1700, 1500, { p1Points: 30, p2Points: 10, innings: 8, p1HighRun: 8, p2HighRun: 3, target: 30 }, { d: config.d, k_m: config.k_m, sp });
  const eloA1 = 1700 + outcome1.change, eloB1 = 1500 - outcome1.change;
  const outcome2 = straightPoolMatchOutcome(eloA1, eloB1, { p1Points: 20, p2Points: 40, innings: 10, p1HighRun: 5, p2HighRun: 12, target: 40 }, { d: config.d, k_m: config.k_m, sp });

  const a = result.find((p) => p.id === 1);
  assert.equal(a.elo, eloA1 + outcome2.change);
  assert.equal(a.pointsFor, 30 + 20);
  assert.equal(a.hs, Math.max(8, 5));
});

test('8: 14.1 match uses the historically stored target, not a target recomputed from current tier config', () => {
  const config = spConfig({ straightPool: { enabled: true, tierTargets: [99, 88, 77], startTarget: 55, tieringStartsRound: 1 } });
  const sp = { ...config.straightPool };
  const storedTarget = 30; // historically stored — deliberately different from current tier config
  const match = { id: 1, p1: { id: 1 }, p2: { id: 2 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', target: storedTarget, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 };

  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1700), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1700], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });

  const expected = straightPoolMatchOutcome(1700, 1500, { p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, target: storedTarget }, { d: config.d, k_m: config.k_m, sp });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.npd, expected.npdA); // npd depends on target — proves storedTarget (30), not 55/99, was used
});

test('a 14.1 match with no stored target falls back to sp.startTarget (matching straightPoolMatchOutcome\'s own fallback)', () => {
  const config = spConfig();
  const match = { id: 1, p1: { id: 1 }, p2: { id: 2 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', p1Points: 20, p2Points: 10, innings: 6, p1HighRun: 5, p2HighRun: 3 }; // no `target`
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1700), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1700], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.npd, (20 - 10) / config.straightPool.startTarget);
});

// =============================================================================
// 9-10. Byes
// =============================================================================

test('9: a fixed-rack bye grants +1 MP and the win/round RP component, but NO games increment and no racks/GBR/PERF/opponent (authoritative BBS rule — a bye is not a played match)', () => {
  const config = fixedConfig();
  const bye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [bye] }, currentRound: 1, config
  });
  const a = result[0];
  assert.equal(a.mp, 1);
  assert.equal(a.games, 0); // NOT a played game
  assert.equal(a.elo, 1600); // unchanged — no GBR calculation for a bye
  assert.equal(a.perf, 0);
  assert.equal(a.perfCount, 0);
  assert.equal(a.racksWon, 0);
  assert.equal(a.racksLost, 0);
  assert.deepEqual(a.opps, []); // FREILOS never becomes an opponent
  assert.equal(a.rp, rpFormula(1, 0, config)); // rp_per_round + 1*rp_per_mp, no GBR-change component
});

test('a fixed-rack bye stored in the Manual Pairing Editor encoding (r1: max_games, r2: 0) is treated identically — MP/RP via matchPoints(), no games increment', () => {
  const config = fixedConfig();
  const bye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: config.max_games, r2: 0, done: true, cancelled: false, bye: true };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [bye] }, currentRound: 1, config
  });
  const a = result[0];
  assert.equal(a.mp, 1);
  assert.equal(a.games, 0);
  assert.equal(a.rp, rpFormula(1, 0, config));
});

test('a bye grants no RP when config.use_rp is false, while MP still increases by 1 and games still does not', () => {
  const config = fixedConfig({ use_rp: false });
  const bye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [bye] }, currentRound: 1, config
  });
  const a = result[0];
  assert.equal(a.mp, 1);
  assert.equal(a.games, 0);
  assert.equal(a.rp, 0);
});

test('10: a 14.1-formatted bye takes the SAME dedicated bye path as fixed-rack — +1 MP, RP, no games, no 14.1 aggregate field touched', () => {
  const config = spConfig();
  const bye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'straight_pool_14_1', target: 0 };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [bye] }, currentRound: 1, config
  });
  const a = result[0];
  assert.equal(a.mp, 1);
  assert.equal(a.games, 0);
  assert.equal(a.rp, rpFormula(1, 0, config));
  assert.equal(a.pointsFor, 0);
  assert.equal(a.pointsAgainst, 0);
  assert.equal(a.inningsTotal, 0);
  assert.equal(a.npd, 0);
  assert.equal(a.hs, 0);
  assert.equal(a.hgd, 0);
  assert.equal(a.perfCount, 0);
});

// =============================================================================
// 11-12. Cancelled / incomplete
// =============================================================================

test('11: a cancelled (done: true, cancelled: true) match contributes nothing', () => {
  const config = fixedConfig();
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: true, bye: false, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.mp, 0);
  assert.equal(a.games, 0);
  assert.equal(a.elo, 1600);
});

test('12: an incomplete (done: false) match contributes nothing, even if scores are present', () => {
  const config = fixedConfig();
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: false, cancelled: false, bye: false, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.games, 0);
});

// =============================================================================
// 13. RP / repeat opponent
// =============================================================================

test('13: RP is disabled entirely when config.use_rp is false', () => {
  const config = fixedConfig({ use_rp: false });
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds: { 1: [match] }, currentRound: 1, config
  });
  result.forEach((p) => assert.equal(p.rp, 0));
});

test('a repeated opponent across rounds accrues RP each time but only appears once in opps', () => {
  const config = fixedConfig();
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    2: [{ id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }]
  };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds, currentRound: 2, config
  });
  const a = result.find((p) => p.id === 1);
  assert.deepEqual(a.opps, [2]); // not [2, 2]
  assert.ok(a.rp > 0); // RP still accrued for both matches (rp_per_round alone guarantees > 0)
});

// =============================================================================
// 14-15. Starting GBR source
// =============================================================================

test('14: starting GBR is read from the roster, overriding the player\'s own (possibly stale) elo', () => {
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 9999)], // stale current elo
    roster: roster([[1, 'Alpha', 1600]]),
    rounds: {}, currentRound: 0, config: fixedConfig()
  });
  assert.equal(result[0].elo, 1600);
});

test('15: a player absent from the roster falls back to their own current elo (last-known value)', () => {
  const result = recalculateTournamentPlayers({
    players: [player(5, 'Ghost', 1550)],
    roster: roster([[1, 'Alpha', 1600]]), // id 5 not present
    rounds: {}, currentRound: 0, config: fixedConfig()
  });
  assert.equal(result[0].elo, 1550);
});

test('duplicate/colliding roster ids: LAST matching entry wins (plain-object key coercion, not first-match .find() semantics)', () => {
  // Mirrors recalc()'s actual `startElos[p.id] = p.elo` loop exactly — this
  // is a real, preserved quirk, not cleaned up into .find()-based lookup.
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1000)],
    roster: roster([[1, 'Alpha (first)', 1600], [1, 'Alpha (duplicate)', 1700]]),
    rounds: {}, currentRound: 0, config: fixedConfig()
  });
  assert.equal(result[0].elo, 1700); // the LAST roster entry with id 1, not the first
});

// =============================================================================
// 16. joinedRound
// =============================================================================

test('16: joinedRound is preserved unchanged and does not gate replay', () => {
  const players = [player(1, 'Alpha', 1600), { ...player(2, 'LateJoiner', 1500), joinedRound: 2 }];
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' };
  const result = recalculateTournamentPlayers({
    players, roster: roster([[1, 'Alpha', 1600], [2, 'LateJoiner', 1500]]),
    rounds: { 2: [match] }, currentRound: 2, config: fixedConfig()
  });
  const late = result.find((p) => p.id === 2);
  assert.equal(late.joinedRound, 2); // preserved
  assert.equal(late.games, 1); // still replayed — recalc() itself does not gate on joinedRound
});

// =============================================================================
// 17. Steady-state shape
// =============================================================================

test('17: the returned shape always includes every steady-state field, even for a purely fixed-rack tournament', () => {
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: {}, currentRound: 0, config: fixedConfig()
  });
  const p = result[0];
  ['mp', 'perf', 'perfCount', 'elo', 'games', 'opps', 'rp', 'racksWon', 'racksLost', 'pointsFor', 'pointsAgainst', 'inningsTotal', 'npd', 'hs', 'hgd'].forEach((field) => {
    assert.ok(field in p, `missing field ${field}`);
  });
});

// =============================================================================
// 18-19. Immutability
// =============================================================================

test('18/19: does not mutate players, roster, rounds, or config; rounds/matches remain byte-identical', () => {
  const players = [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)];
  const rosterArg = roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]);
  const rounds = { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }] };
  const config = fixedConfig();

  const playersSnapshot = JSON.parse(JSON.stringify(players));
  const rosterSnapshot = JSON.parse(JSON.stringify(rosterArg));
  const roundsSnapshot = JSON.parse(JSON.stringify(rounds));
  const configSnapshot = JSON.parse(JSON.stringify(config));

  recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config });

  assert.deepEqual(players, playersSnapshot);
  assert.deepEqual(rosterArg, rosterSnapshot);
  assert.deepEqual(rounds, roundsSnapshot); // proves no pairing/match data was altered
  assert.deepEqual(config, configSnapshot);
});

// =============================================================================
// 20. Replay idempotence
// =============================================================================

test('20: recalculating twice from the same history produces the same result (does not stack on already-derived numbers)', () => {
  const roster1 = roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]);
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    2: [{ id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }]
  };
  const config = fixedConfig();

  const originalPlayers = [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)];
  const resultA = recalculateTournamentPlayers({ players: originalPlayers, roster: roster1, rounds, currentRound: 2, config });
  // Feed the ALREADY-recalculated players back in as the input `players` —
  // if this doubled the effect, elo/mp would differ from resultA.
  const resultB = recalculateTournamentPlayers({ players: resultA, roster: roster1, rounds, currentRound: 2, config });

  assert.deepEqual(resultA, resultB);
});

// =============================================================================
// 21. before-round consistency
// =============================================================================

test('21: full recalculation through round N-1 is consistent with reconstructStandingsBeforeRound(roundLimit: N) for overlapping fields', () => {
  const config = fixedConfig();
  const players = [player(1, 'Alpha', 1700), player(2, 'Bravo', 1600), player(3, 'Charlie', 1500), player(4, 'Delta', 1400)];
  const rosterArg = players.map(({ id, name, elo }) => ({ id, name, elo }));
  const rounds = {
    1: [
      { id: 'r1m1', p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false, format: 'fixed_rack' },
      { id: 'r1m2', p1: { id: 3, elo: 1500 }, p2: { id: 4, elo: 1400 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }
    ]
  };

  const recalced = recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config });
  const beforeRound2 = reconstructStandingsBeforeRound({ players, startingRoster: rosterArg, rounds, roundLimit: 2, config });

  // Compare overlapping fields only — RP is deliberately excluded from
  // reconstructStandingsBeforeRound(), and eligibility filtering doesn't
  // apply here (no removed/late-joined players in this fixture).
  for (const p of recalced) {
    const before = beforeRound2[p.id];
    assert.equal(p.elo, before.elo, `${p.name} elo`);
    assert.equal(p.mp, before.mp, `${p.name} mp`);
    assert.equal(p.perf, before.perf, `${p.name} perf`);
    assert.equal(p.racksWon, before.racksWon, `${p.name} racksWon`);
    assert.equal(p.racksLost, before.racksLost, `${p.name} racksLost`);
    assert.deepEqual(p.opps, before.opps, `${p.name} opps`);
  }
});

test('21b: 14.1 full recalculation is consistent with reconstructStandingsBeforeRound for overlapping fields', () => {
  const config = spConfig();
  const players = [player(1, 'Alpha', 1700), player(2, 'Bravo', 1500)];
  const rosterArg = players.map(({ id, name, elo }) => ({ id, name, elo }));
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }]
  };

  const recalced = recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config });
  const beforeRound2 = reconstructStandingsBeforeRound({ players, startingRoster: rosterArg, rounds, roundLimit: 2, config });

  for (const p of recalced) {
    const before = beforeRound2[p.id];
    assert.equal(p.elo, before.elo, `${p.name} elo`);
    assert.equal(p.mp, before.mp, `${p.name} mp`);
    assert.equal(p.pointsFor, before.pointsFor, `${p.name} pointsFor`);
    assert.equal(p.npd, before.npd, `${p.name} npd`);
    assert.equal(p.hgd, before.hgd, `${p.name} hgd`);
  }
});

test('KNOWN, INTENTIONAL DIVERGENCE: for a bye, recalculateTournamentPlayers().games (corrected — no increment) now differs from reconstructStandingsBeforeRound().games (unchanged — still increments), by explicit director decision; MP itself still agrees', () => {
  const config = fixedConfig();
  const players = [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500), player(3, 'Charlie', 1550)];
  const rosterArg = players.map(({ id, name, elo }) => ({ id, name, elo }));
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'fixed_rack' }]
  };

  const recalced = recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config });
  const beforeRound2 = reconstructStandingsBeforeRound({ players, startingRoster: rosterArg, rounds, roundLimit: 2, config });

  const a = recalced.find((p) => p.id === 1);
  const aBefore = beforeRound2[1];
  assert.equal(a.mp, aBefore.mp); // MP agreement unaffected
  assert.equal(a.games, 0); // corrected canonical rule: a bye is not a played game
  assert.equal(aBefore.games, 1); // reconstructStandingsBeforeRound() is untouched — out of scope for this correction
  assert.notEqual(a.games, aBefore.games); // the divergence itself, made explicit rather than silently reconciled
});

// =============================================================================
// Round-number bounds (currentRound / round-key edge cases)
// =============================================================================

test('rounds keyed beyond currentRound are never replayed', () => {
  const config = fixedConfig();
  const rounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    2: [{ id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }]
  };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds, currentRound: 1, config // round 2 exists but currentRound stops at 1
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.games, 1); // only round 1 counted
});

test('a round keyed below 1 (e.g. "0") is never replayed, matching recalc()\'s 1..currentRound loop bound', () => {
  const config = fixedConfig();
  const rounds = {
    0: [{ id: 'x', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, format: 'fixed_rack' }]
  };
  const result = recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)],
    roster: roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]),
    rounds, currentRound: 1, config
  });
  const a = result.find((p) => p.id === 1);
  assert.equal(a.games, 1); // only round 1, not round 0
});

// =============================================================================
// Config-history behavior (CURRENT legacy compatibility)
// =============================================================================

test('CURRENT LEGACY COMPATIBILITY: changing the active config retroactively changes ALL already-played rounds\' derived numbers, not just future ones', () => {
  const players = [player(1, 'Alpha', 1600), player(2, 'Bravo', 1500)];
  const rosterArg = roster([[1, 'Alpha', 1600], [2, 'Bravo', 1500]]);
  const rounds = { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }] };

  const resultOldConfig = recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config: fixedConfig({ k_m: 30 }) });
  const resultNewConfig = recalculateTournamentPlayers({ players, roster: rosterArg, rounds, currentRound: 1, config: fixedConfig({ k_m: 60 }) });

  const a1 = resultOldConfig.find((p) => p.id === 1);
  const a2 = resultNewConfig.find((p) => p.id === 1);
  assert.notEqual(a1.elo, a2.elo); // round 1's own already-played result changed with the config
});

// =============================================================================
// Discovered quirk: missing player throws (structurally-only-reachable)
// =============================================================================

test('a match referencing a player id absent from the working players array throws (mirrors recalc()\'s unguarded .find() lookup; not reachable through any current UI deletion path)', () => {
  const config = fixedConfig();
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 99, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }; // id 99 not in players
  assert.throws(() => recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [match] }, currentRound: 1, config
  }));
});

test('the same missing-player throw occurs for a 14.1 match', () => {
  const config = spConfig();
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 99, elo: 1500 }, done: true, cancelled: false, bye: false, format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 10, innings: 8, p1HighRun: 5, p2HighRun: 3 };
  assert.throws(() => recalculateTournamentPlayers({
    players: [player(1, 'Alpha', 1600)], roster: roster([[1, 'Alpha', 1600]]),
    rounds: { 1: [match] }, currentRound: 1, config
  }));
});
