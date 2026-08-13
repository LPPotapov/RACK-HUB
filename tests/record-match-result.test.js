import assert from 'node:assert/strict';
import test from 'node:test';
import { recordMatchResult } from '../src/application/tournamentCommands.js';
import { createTournamentStore } from '../src/application/tournamentStore.js';
import {
  createApplicationState,
  createConfig,
  createMatch,
  createPlayer,
  createTournamentState,
  validateApplicationState
} from '../src/domain/tournamentModel.js';

const fixedConfig = (overrides = {}) => createConfig(overrides);
const spConfig = (overrides = {}) => createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true }, ...overrides });

// A RUNNING two-player fixed-rack tournament with one incomplete Round 1 match.
const runningFixedRackState = (overrides = {}) => {
  const config = overrides.config || fixedConfig();
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const match = overrides.match || { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 3, format: 'fixed_rack' };
  return createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [p1, p2],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: overrides.rounds || { 1: [match] },
      currentRound: overrides.currentRound ?? 1
    })
  });
};

const runningStraightPoolState = (overrides = {}) => {
  const config = overrides.config || spConfig();
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1700 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const match = overrides.match || {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1,
    format: 'straight_pool_14_1', target: 30, p1Points: 0, p2Points: 0, innings: 0, p1HighRun: 0, p2HighRun: 0
  };
  return createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: { title: '14.1 Club', ...config },
      players: [p1, p2],
      roster: [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: overrides.rounds || { 1: [match] },
      currentRound: overrides.currentRound ?? 1
    })
  });
};

// =============================================================================
// FIXED-RACK (Part 17)
// =============================================================================

test('1/2: entering a result on an incomplete fixed-rack match completes it (done: true)', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  const m = next.tournament.rounds[1][0];
  assert.equal(m.r1, 4);
  assert.equal(m.r2, 2);
  assert.equal(m.done, true);
});

test('3-7: fixed-rack result recalculates MP/racks/PERF/GBR/games/opponents', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  const a = next.tournament.players.find((p) => p.id === 1);
  const b = next.tournament.players.find((p) => p.id === 2);

  assert.equal(a.mp, 1);
  assert.equal(a.racksWon, 4);
  assert.equal(a.racksLost, 2);
  assert.ok(a.perf !== 0);
  assert.notEqual(a.elo, 1600);
  assert.equal(a.games, 1);
  assert.deepEqual(a.opps, [2]);

  assert.equal(b.mp, 0);
  assert.equal(b.racksWon, 2);
  assert.equal(b.racksLost, 4);
});

test('fixed-rack auto-complete: entering only one side computes the other as max_games - entered', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 0 });
  const m = next.tournament.rounds[1][0];
  assert.equal(m.r1, 4);
  assert.equal(m.r2, state.tournament.config.max_games - 4);
});

test('fixed-rack: an invalid total (not equal to max_games) is rejected', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 3, r2: 1 }), /total racks must equal/);
});

test('fixed-rack: a zero-zero result (no score entered) is rejected', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 0, r2: 0 }), /at least one score/);
});

test('8/9: correcting an already-done fixed-rack result recalculates derived numbers from the new values', () => {
  const doneMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 3, format: 'fixed_rack' };
  const state = runningFixedRackState({ match: doneMatch });
  const before = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }); // no-op re-entry
  const corrected = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 2, r2: 4 }); // flipped result

  const beforeA = before.tournament.players.find((p) => p.id === 1);
  const correctedA = corrected.tournament.players.find((p) => p.id === 1);
  assert.equal(beforeA.mp, 1);
  assert.equal(correctedA.mp, 0); // now the loser
  assert.notEqual(beforeA.elo, correctedA.elo);
});

test('10: correcting a Round 1 result leaves later stored rounds structurally unchanged', () => {
  const doneR1 = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 3, format: 'fixed_rack' };
  const r2match = { id: 2, p1: { id: 1, elo: 1613 }, p2: { id: 2, elo: 1487 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, tbl: 5, format: 'fixed_rack' };
  const state = runningFixedRackState({ rounds: { 1: [doneR1], 2: [r2match] }, currentRound: 2 });

  const corrected = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 2, r2: 4 });

  assert.deepEqual(corrected.tournament.rounds[2], state.tournament.rounds[2]);
});

test('11/12/13: table, p1/p2, and match id/order are preserved by a result entry', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  const m = next.tournament.rounds[1][0];
  assert.equal(m.tbl, 3);
  assert.deepEqual(m.p1, { id: 1, elo: 1600 });
  assert.deepEqual(m.p2, { id: 2, elo: 1500 });
  assert.equal(m.id, 1);
  assert.equal(next.tournament.rounds[1].length, 1);
});

test('14: a format-less match (Manual Pairing Editor shape) is treated as fixed-rack', () => {
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1 }; // no format
  const state = runningFixedRackState({ match });
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  assert.equal(next.tournament.rounds[1][0].done, true);
  assert.equal('format' in next.tournament.rounds[1][0], false); // never invented
});

test('15: a missing round or match throws a clear, distinct error', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 2, matchId: 1, r1: 4, r2: 2 }), /round 2 does not exist/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 'nope', r1: 4, r2: 2 }), /does not exist in round/);
});

test('16: an EMPTY application throws', () => {
  assert.throws(() => recordMatchResult(createApplicationState(), { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /no tournament/);
});

test('17: a CONFIGURED_PRE_START (started: false) application throws', () => {
  const config = fixedConfig();
  const preStart = createApplicationState({
    tournament: createTournamentState({
      started: false, config, tournamentConfig: { title: 'Club Night', ...config },
      players: [], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0
    })
  });
  assert.throws(() => recordMatchResult(preStart, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /not started/);
});

test('18: does not mutate its ApplicationState input', () => {
  const state = runningFixedRackState();
  const snapshot = JSON.parse(JSON.stringify(state));
  recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  assert.deepEqual(state, snapshot);
});

test('a failed result entry leaves the input completely unchanged', () => {
  const state = runningFixedRackState();
  const snapshot = JSON.parse(JSON.stringify(state));
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 3, r2: 1 }));
  assert.deepEqual(state, snapshot);
});

// =============================================================================
// 14.1 (Part 18)
// =============================================================================

test('1-4: initial 14.1 result entry stores points/innings/high-runs', () => {
  const state = runningStraightPoolState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 });
  const m = next.tournament.rounds[1][0];
  assert.equal(m.p1Points, 30);
  assert.equal(m.p2Points, 16);
  assert.equal(m.innings, 9);
  assert.equal(m.p1HighRun, 9);
  assert.equal(m.p2HighRun, 4);
});

test('5: completion sets done: true and mirrors r1/r2 to p1Points/p2Points', () => {
  const state = runningStraightPoolState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 });
  const m = next.tournament.rounds[1][0];
  assert.equal(m.done, true);
  assert.equal(m.r1, 30);
  assert.equal(m.r2, 16);
});

test('6-12: 14.1 result recalculates MP/PERF/GBR/pointsFor/pointsAgainst/inningsTotal/npd/hs/hgd', () => {
  const state = runningStraightPoolState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 });
  const a = next.tournament.players.find((p) => p.id === 1);

  assert.equal(a.mp, 1);
  assert.ok(a.perf !== 0);
  assert.notEqual(a.elo, 1700);
  assert.equal(a.pointsFor, 30);
  assert.equal(a.pointsAgainst, 16);
  assert.equal(a.inningsTotal, 9);
  assert.notEqual(a.npd, 0);
  assert.equal(a.hs, 9);
  assert.ok(a.hgd > 0);
});

test('13: correcting a completed 14.1 result recalculates from the new values', () => {
  const doneMatch = {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 30, r2: 16, done: true, cancelled: false, bye: false, tbl: 1,
    format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
  };
  const state = runningStraightPoolState({ match: doneMatch });
  const corrected = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 16, p2Points: 30, innings: 9, p1HighRun: 4, p2HighRun: 9 });
  const a = corrected.tournament.players.find((p) => p.id === 1);
  assert.equal(a.mp, 0); // now the loser
  assert.equal(a.pointsFor, 16);
});

test('14: correcting a 14.1 result preserves the historically stored target', () => {
  const doneMatch = {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 30, r2: 16, done: true, cancelled: false, bye: false, tbl: 1,
    format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
  };
  const state = runningStraightPoolState({ match: doneMatch, config: spConfig({ straightPool: { enabled: true, startTarget: 99 } }) });
  const corrected = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 16, p2Points: 30, innings: 9, p1HighRun: 4, p2HighRun: 9 });
  assert.equal(corrected.tournament.rounds[1][0].target, 30); // unchanged, never recomputed from current config
});

test('15/16: correcting an earlier 14.1 round leaves later stored rounds/pairings unchanged', () => {
  const doneR1 = {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 30, r2: 16, done: true, cancelled: false, bye: false, tbl: 1,
    format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
  };
  const r2match = {
    id: 2, p1: { id: 1, elo: 1707 }, p2: { id: 2, elo: 1493 }, r1: 40, r2: 20, done: true, cancelled: false, bye: false, tbl: 2,
    format: 'straight_pool_14_1', target: 40, p1Points: 40, p2Points: 20, innings: 6, p1HighRun: 15, p2HighRun: 8
  };
  const state = runningStraightPoolState({ rounds: { 1: [doneR1], 2: [r2match] }, currentRound: 2 });

  const corrected = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 16, p2Points: 30, innings: 9, p1HighRun: 4, p2HighRun: 9 });

  assert.deepEqual(corrected.tournament.rounds[2], state.tournament.rounds[2]);
});

test('18: 14.1 invalid-result rejections match legacy exactly (zero points, non-positive innings, negative high run, high run exceeding points)', () => {
  const state = runningStraightPoolState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 0, p2Points: 0, innings: 5, p1HighRun: 0, p2HighRun: 0 }), /points for at least one player/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 10, p2Points: 5, innings: 0, p1HighRun: 0, p2HighRun: 0 }), /innings must be a positive number/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 10, p2Points: 5, innings: 3, p1HighRun: -1, p2HighRun: 0 }), /non-negative/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 10, p2Points: 5, innings: 3, p1HighRun: 11, p2HighRun: 0 }), /high run cannot exceed/);
});

test('a 14.1 result with neither player reaching target still completes (TD override — no rejection, matching legacy\'s console.warn-only behavior)', () => {
  const state = runningStraightPoolState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 18, p2Points: 15, innings: 20, p1HighRun: 5, p2HighRun: 4 });
  assert.equal(next.tournament.rounds[1][0].done, true);
});

// =============================================================================
// Byes and cancelled matches
// =============================================================================

test('a bye match rejects result entry with a clear message — automatic encoding (r1: 0, r2: 0)', () => {
  const byeMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, tbl: 1, format: 'fixed_rack' };
  const state = runningFixedRackState({ match: byeMatch });
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /bye match/);
});

test('a bye match rejects result entry with a clear message — Manual Pairing Editor encoding (r1: max_games, r2: 0)', () => {
  const config = fixedConfig();
  const byeMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: config.max_games, r2: 0, done: true, cancelled: false, bye: true, tbl: 1 };
  const state = runningFixedRackState({ config, match: byeMatch });
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /bye match/);
});

test('a cancelled match is not guarded against at the data layer (matches completeMatch()\'s own lack of a cancelled check) but recalc() still ignores it', () => {
  const cancelledMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: true, bye: false, tbl: 1, format: 'fixed_rack' };
  const state = runningFixedRackState({ match: cancelledMatch });
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });

  assert.equal(next.tournament.rounds[1][0].r1, 4); // fields ARE written
  assert.equal(next.tournament.rounds[1][0].cancelled, true); // cancelled untouched
  const a = next.tournament.players.find((p) => p.id === 1);
  assert.equal(a.mp, 0); // but recalc() still skips a cancelled match entirely
  assert.equal(a.games, 0);
});

// =============================================================================
// Part 20 — result field whitelist
// =============================================================================

test('the command never rewrites p1/p2/tbl/target/format/id/bye — only approved result fields change', () => {
  const state = runningStraightPoolState();
  const before = state.tournament.rounds[1][0];
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 });
  const after = next.tournament.rounds[1][0];

  assert.deepEqual(after.p1, before.p1);
  assert.deepEqual(after.p2, before.p2);
  assert.equal(after.tbl, before.tbl);
  assert.equal(after.target, before.target);
  assert.equal(after.format, before.format);
  assert.equal(after.id, before.id);
  assert.equal(after.bye, before.bye);
  assert.equal(after.cancelled, before.cancelled);
});

test('an unapproved/custom field on the match survives untouched (proves no spread-based overwrite of unrelated data)', () => {
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack', customFlag: 'preserve-me' };
  const state = runningFixedRackState({ match });
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  assert.equal(next.tournament.rounds[1][0].customFlag, 'preserve-me');
});

// =============================================================================
// Part 21 — ApplicationState preservation
// =============================================================================

test('unrelated ApplicationState/Tournament fields are all preserved unchanged', () => {
  const config = fixedConfig();
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const match = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' };
  const otherMatch = { id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 4, format: 'fixed_rack' };
  const state = createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [p1, p2],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      pendingPlayers: [{ id: 3, name: 'Charlie', elo: 1450 }],
      rounds: { 1: [match, otherMatch] },
      currentRound: 1,
      totalRounds: 4
    })
  });

  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });

  assert.equal(next.tournament.started, true);
  assert.deepEqual(next.tournament.config, state.tournament.config);
  assert.deepEqual(next.tournament.tournamentConfig, state.tournament.tournamentConfig);
  assert.deepEqual(next.tournament.roster, state.tournament.roster);
  assert.deepEqual(next.tournament.pendingPlayers, state.tournament.pendingPlayers);
  assert.equal(next.tournament.currentRound, 1);
  assert.equal(next.tournament.totalRounds, 4);
  assert.equal(next.preAdvanceSnapshot, null);
  assert.deepEqual(next.tournament.rounds[1][1], otherMatch); // the OTHER match in the same round is untouched
});

test('the result is a valid canonical ApplicationState', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  assert.deepEqual(validateApplicationState(next), { valid: true, errors: [] });
});

// =============================================================================
// Composition with the application store
// =============================================================================

test('composes with tournamentStore.updateState() to commit a result', () => {
  const store = createTournamentStore(runningFixedRackState());
  store.updateState((current) => recordMatchResult(current, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 }));
  const state = store.getState();
  assert.equal(state.tournament.rounds[1][0].done, true);
  assert.equal(state.tournament.players.find((p) => p.id === 1).mp, 1);
});

// =============================================================================
// CORRECTED NUMERIC INPUT CONTRACT (Codex follow-up)
// =============================================================================
//
// recordMatchResult() must require every authoritative numeric result field
// to already be a finite integer JavaScript number — no Number(...)
// coercion, no parseInt(...), no tolerance for numeric strings/decimals/
// NaN/Infinity. This is what stops a caller from ever persisting a
// fractional score (e.g. r1: 4.9, r2: 1.1, which would otherwise satisfy
// the total-racks check by coincidence: 4.9 + 1.1 === 6).

test('FIXED-RACK: integer numbers succeed', () => {
  const state = runningFixedRackState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: 2 });
  assert.equal(next.tournament.rounds[1][0].r1, 4);
  assert.equal(next.tournament.rounds[1][0].r2, 2);
});

test('FIXED-RACK: a numeric string rejects', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: '4', r2: 2 }), /must both be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4, r2: '2' }), /must both be finite integers/);
});

test('FIXED-RACK: a decimal number rejects', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4.5, r2: 1.5 }), /must both be finite integers/);
});

test('FIXED-RACK: a decimal string rejects', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: '4.9', r2: '1.1' }), /must both be finite integers/);
});

test('FIXED-RACK: NaN rejects', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: NaN, r2: 6 }), /must both be finite integers/);
});

test('FIXED-RACK: Infinity and -Infinity reject', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: Infinity, r2: 6 }), /must both be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: -Infinity, r2: 6 }), /must both be finite integers/);
});

test('FIXED-RACK: null/undefined reject', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: null, r2: 6 }), /must both be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: undefined, r2: 6 }), /must both be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1 }), /must both be finite integers/); // both omitted
});

test('FIXED-RACK: objects/arrays reject', () => {
  const state = runningFixedRackState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: {}, r2: 6 }), /must both be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: [4], r2: 6 }), /must both be finite integers/);
});

test('FIXED-RACK: 4.9/1.1 specifically cannot become a stored six-rack result (the exact Codex-reported exploit)', () => {
  const state = runningFixedRackState();
  const snapshot = JSON.parse(JSON.stringify(state));
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, r1: 4.9, r2: 1.1 }), /must both be finite integers/);
  assert.deepEqual(state, snapshot); // input completely unchanged — nothing was ever stored
});

test('14.1: integer values succeed', () => {
  const state = runningStraightPoolState();
  const next = recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 });
  assert.equal(next.tournament.rounds[1][0].p1Points, 30);
});

test('14.1: numeric strings reject', () => {
  const state = runningStraightPoolState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: '30', p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }), /must all be finite integers/);
});

test('14.1: decimal values reject', () => {
  const state = runningStraightPoolState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: 30.5, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }), /must all be finite integers/);
});

test('14.1: NaN/Infinity reject', () => {
  const state = runningStraightPoolState();
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: NaN, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }), /must all be finite integers/);
  assert.throws(() => recordMatchResult(state, { roundNumber: 1, matchId: 1, p1Points: Infinity, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }), /must all be finite integers/);
});

test('14.1: every authoritative result field individually passes through integer validation', () => {
  const state = runningStraightPoolState();
  const valid = { p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 };
  for (const field of Object.keys(valid)) {
    assert.throws(
      () => recordMatchResult(state, { roundNumber: 1, matchId: 1, ...valid, [field]: `${valid[field]}` }),
      /must all be finite integers/,
      `${field} as a numeric string should reject`
    );
    assert.throws(
      () => recordMatchResult(state, { roundNumber: 1, matchId: 1, ...valid, [field]: valid[field] + 0.5 }),
      /must all be finite integers/,
      `${field} as a decimal should reject`
    );
  }
});

// =============================================================================
// Store atomicity failure matrix (Codex follow-up)
// =============================================================================

test('store atomicity matrix: pre-start, missing round, missing match, invalid 14.1, both bye encodings, and invalid non-integer result all fail atomically', () => {
  // pre-start
  {
    const config = fixedConfig();
    const preStart = createApplicationState({
      tournament: createTournamentState({
        started: false, config, tournamentConfig: { title: 'Club Night', ...config },
        players: [], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0
      })
    });
    const store = createTournamentStore(preStart);
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /not started/);
    assert.deepEqual(store.getState(), before);
  }

  // missing round
  {
    const store = createTournamentStore(runningFixedRackState());
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 99, matchId: 1, r1: 4, r2: 2 }), /round 99 does not exist/);
    assert.deepEqual(store.getState(), before);
  }

  // missing match
  {
    const store = createTournamentStore(runningFixedRackState());
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 'nope', r1: 4, r2: 2 }), /does not exist in round/);
    assert.deepEqual(store.getState(), before);
  }

  // invalid 14.1 (zero points)
  {
    const store = createTournamentStore(runningStraightPoolState());
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 1, p1Points: 0, p2Points: 0, innings: 5, p1HighRun: 0, p2HighRun: 0 }), /points for at least one player/);
    assert.deepEqual(store.getState(), before);
  }

  // automatic bye encoding
  {
    const byeMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, tbl: 1, format: 'fixed_rack' };
    const store = createTournamentStore(runningFixedRackState({ match: byeMatch }));
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /bye match/);
    assert.deepEqual(store.getState(), before);
  }

  // manual-editor bye encoding
  {
    const config = fixedConfig();
    const byeMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: config.max_games, r2: 0, done: true, cancelled: false, bye: true, tbl: 1 };
    const store = createTournamentStore(runningFixedRackState({ config, match: byeMatch }));
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 1, r1: 4, r2: 2 }), /bye match/);
    assert.deepEqual(store.getState(), before);
  }

  // invalid non-integer result
  {
    const store = createTournamentStore(runningFixedRackState());
    const before = store.getState();
    assert.throws(() => store.recordMatchResult({ roundNumber: 1, matchId: 1, r1: 4.9, r2: 1.1 }), /must both be finite integers/);
    assert.deepEqual(store.getState(), before);
  }
});
