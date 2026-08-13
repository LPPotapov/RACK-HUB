import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceTournamentRound, recordMatchResult } from '../src/application/tournamentCommands.js';
import { createTournamentStore } from '../src/application/tournamentStore.js';
import {
  createApplicationState,
  createConfig,
  createPlayer,
  createPreAdvanceSnapshot,
  createTournamentState,
  validateApplicationState
} from '../src/domain/tournamentModel.js';

const fixedConfig = (overrides = {}) => createConfig(overrides);
const spConfig = (overrides = {}) => createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true }, ...overrides });

// Round 1 deterministic fixture (see docs/ARCHITECTURE.md / final report for
// the hand-verified expected Round 2 pairing): Alpha beats Bravo decisively;
// Charlie draws Delta. This produces distinct (mp, perf) values for every
// player except the Charlie/Delta MP tie, which PERF breaks unambiguously
// (Delta's draw-PERF equals Charlie's starting elo 1550; Charlie's equals
// Delta's starting elo 1450) — so the resulting seed order and Swiss/cost-
// based Round 2 pairing (Alpha vs Delta, Charlie vs Bravo) is fully
// deterministic regardless of floating-point rounding noise.
const runningFourPlayerState = (overrides = {}) => {
  const config = overrides.config || fixedConfig(overrides.configOverrides);
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 },
    { id: 4, name: 'Delta', elo: 1450 }
  ];
  const round1 = overrides.round1 || [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' },
    { id: 'm2', p1: { id: 3, elo: 1550 }, p2: { id: 4, elo: 1450 }, r1: 3, r2: 3, done: true, cancelled: false, bye: false, tbl: 2, format: 'fixed_rack' }
  ];
  return createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: overrides.tournamentConfig || { title: 'Club Night', ...config },
      players: roster.map(({ id, name, elo }) => createPlayer({ id, name, elo })),
      roster,
      pendingPlayers: overrides.pendingPlayers || [],
      rounds: { 1: round1 },
      currentRound: 1,
      totalRounds: overrides.totalRounds ?? 4
    })
  });
};

// =============================================================================
// 1-4. Core advancement / pairing
// =============================================================================

test('1/2: a completed Round 1 advances to Round 2; currentRound increments', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  assert.equal(next.tournament.currentRound, 2);
  assert.ok(next.tournament.rounds[2]);
});

test('3: prior rounds remain deep-equal after advancing', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  assert.deepEqual(next.tournament.rounds[1], state.tournament.rounds[1]);
});

test('4: correct next-round pairing (deterministic hand-verified Swiss/cost-based order)', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  const round2 = next.tournament.rounds[2];
  assert.equal(round2.length, 2);
  assert.equal(round2[0].p1.id, 1); // Alpha
  assert.equal(round2[0].p2.id, 4); // Delta
  assert.equal(round2[1].p1.id, 3); // Charlie
  assert.equal(round2[1].p2.id, 2); // Bravo
  round2.forEach((m) => assert.equal(m.format, 'fixed_rack'));
});

// =============================================================================
// 5-6. Completion gate
// =============================================================================

test('5: an incomplete round (a match still not done/cancelled) is rejected', () => {
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' },
    { id: 'm2', p1: { id: 3, elo: 1550 }, p2: { id: 4, elo: 1450 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 2, format: 'fixed_rack' }
  ];
  const state = runningFourPlayerState({ round1 });
  assert.throws(() => advanceTournamentRound(state), /must be completed or cancelled/);
});

test('6: a cancelled match counts as "complete" for the gate (advancement succeeds)', () => {
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' },
    { id: 'm2', p1: { id: 3, elo: 1550 }, p2: { id: 4, elo: 1450 }, r1: 0, r2: 0, done: false, cancelled: true, bye: false, tbl: 2, format: 'fixed_rack' }
  ];
  const state = runningFourPlayerState({ round1 });
  const next = advanceTournamentRound(state);
  assert.equal(next.tournament.currentRound, 2);
});

test('a bye in the current round counts as "complete" (already done: true)', () => {
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 }
  ];
  const config = fixedConfig();
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' },
    { id: 'm2', p1: { id: 3, elo: 1550 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, tbl: 2, format: 'fixed_rack' }
  ];
  const state = createApplicationState({
    tournament: createTournamentState({
      started: true, config, tournamentConfig: { title: 'Club Night', ...config },
      players: roster.map(({ id, name, elo }) => createPlayer({ id, name, elo })),
      roster, pendingPlayers: [], rounds: { 1: round1 }, currentRound: 1, totalRounds: 4
    })
  });
  const next = advanceTournamentRound(state);
  assert.equal(next.tournament.currentRound, 2);
  // The bye recipient's stats reflect the corrected canonical bye rule (no games).
  const charlie = next.tournament.players.find((p) => p.id === 3);
  assert.equal(charlie.mp, 1);
  assert.equal(charlie.games, 0);
});

// =============================================================================
// 7-9. Pending players
// =============================================================================

test('7/8/9: a pending player is promoted into tournament.players with joinedRound stamped, and pendingPlayers is cleared', () => {
  const pendingPlayers = [{ id: 5, name: 'Echo', elo: 1520 }];
  const state = runningFourPlayerState({ pendingPlayers });
  const next = advanceTournamentRound(state);

  const echo = next.tournament.players.find((p) => p.id === 5);
  assert.ok(echo);
  assert.equal(echo.joinedRound, 2);
  assert.equal(echo.mp, 0);
  assert.equal(echo.games, 0);
  assert.deepEqual(echo.opps, []);
  assert.equal('rp' in echo, false); // transient shape — matches nextRound()'s own construction exactly
  assert.equal('pointsFor' in echo, false);
  assert.deepEqual(next.tournament.pendingPlayers, []);
});

test('a promoted pending player is included in Round 2 pairing (paired against someone, not left out)', () => {
  const pendingPlayers = [{ id: 5, name: 'Echo', elo: 1520 }];
  const state = runningFourPlayerState({ pendingPlayers });
  const next = advanceTournamentRound(state);
  const round2Ids = next.tournament.rounds[2].flatMap((m) => [m.p1.id, m.p2.id]);
  assert.ok(round2Ids.includes(5));
});

// =============================================================================
// 10. Table assignment
// =============================================================================

test('10: table numbering defaults to sequential (1-based, restarting from index 0) and honors an explicit tableNumbers argument', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  assert.equal(next.tournament.rounds[2][0].tbl, 1);
  assert.equal(next.tournament.rounds[2][1].tbl, 2);

  const withTables = advanceTournamentRound(state, { tableNumbers: [11, 12] });
  assert.equal(withTables.tournament.rounds[2][0].tbl, 11);
  assert.equal(withTables.tournament.rounds[2][1].tbl, 12);
});

// =============================================================================
// 11. preAdvanceSnapshot
// =============================================================================

test('11: preAdvanceSnapshot captures the exact pre-advance state in the legacy shape', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);

  const snap = next.preAdvanceSnapshot;
  assert.ok(snap);
  assert.deepEqual(snap.tournament, { players: state.tournament.players, totalRounds: state.tournament.totalRounds });
  assert.deepEqual(snap.allRounds, state.tournament.rounds);
  assert.equal(snap.currentRound, 1);
  assert.equal(snap.viewingRound, 1);
  assert.deepEqual(snap.pendingPlayers, state.tournament.pendingPlayers);
  assert.equal('rounds' in snap, false); // never renamed from allRounds
});

// =============================================================================
// preAdvanceSnapshot detachment (Codex follow-up)
// =============================================================================
//
// Value equality at capture time is not enough — the snapshot must be fully
// detached (no shared references in either direction) from the command
// input AND from the returned tournament, exactly like legacy's own
// JSON.parse(JSON.stringify(...)) capture. These tests prove reference/
// mutation isolation, not just value equality.

test('preAdvanceSnapshot.allRounds is fully detached from both the input and the returned tournament.rounds (round arrays/matches)', () => {
  const pendingPlayers = [{ id: 5, name: 'Echo', elo: 1520 }];
  const state = runningFourPlayerState({ pendingPlayers });
  const inputSnapshot = JSON.parse(JSON.stringify(state));

  const next = advanceTournamentRound(state);

  // Mutate a prior-round match in the RETURNED tournament.
  next.tournament.rounds[1][0].r1 = 999;
  next.tournament.rounds[1][0].p1.name = 'MUTATED';
  // The snapshot's copy of that same round must be untouched.
  assert.notEqual(next.preAdvanceSnapshot.allRounds[1][0].r1, 999);
  assert.notEqual(next.preAdvanceSnapshot.allRounds[1][0].p1.name, 'MUTATED');

  // Mutate the SNAPSHOT's round data.
  next.preAdvanceSnapshot.allRounds[1][0].r1 = 12345;
  next.preAdvanceSnapshot.allRounds[2] = [{ id: 'injected' }];
  // The returned tournament's rounds must be untouched.
  assert.notEqual(next.tournament.rounds[1][0].r1, 12345);
  assert.notEqual(next.tournament.rounds[2][0]?.id, 'injected');

  // The original command input must remain byte-identical throughout.
  assert.deepEqual(state, inputSnapshot);
});

test('preAdvanceSnapshot.tournament.players is fully detached from both the input and the returned tournament.players', () => {
  const state = runningFourPlayerState();
  const inputSnapshot = JSON.parse(JSON.stringify(state));

  const next = advanceTournamentRound(state);

  next.tournament.players[0].elo = 9999;
  next.tournament.players[0].name = 'MUTATED';
  assert.notEqual(next.preAdvanceSnapshot.tournament.players[0].elo, 9999);
  assert.notEqual(next.preAdvanceSnapshot.tournament.players[0].name, 'MUTATED');

  next.preAdvanceSnapshot.tournament.players[0].elo = 12345;
  assert.notEqual(next.tournament.players[0].elo, 12345);

  assert.deepEqual(state, inputSnapshot);
  assert.notEqual(state.tournament.players[0].elo, 9999); // input.tournament.players untouched by any of the above
});

test('preAdvanceSnapshot.pendingPlayers is fully detached from both the input and the returned tournament.pendingPlayers', () => {
  const pendingPlayers = [{ id: 5, name: 'Echo', elo: 1520 }];
  const state = runningFourPlayerState({ pendingPlayers });
  const inputSnapshot = JSON.parse(JSON.stringify(state));

  const next = advanceTournamentRound(state);

  // result.tournament.pendingPlayers is already always [] on success, but
  // prove the snapshot doesn't alias the INPUT's pendingPlayers array either.
  assert.deepEqual(next.tournament.pendingPlayers, []);
  next.preAdvanceSnapshot.pendingPlayers[0].elo = 9999;
  next.preAdvanceSnapshot.pendingPlayers.push({ id: 6, name: 'Injected', elo: 1 });

  assert.deepEqual(state, inputSnapshot); // input.tournament.pendingPlayers untouched
  assert.equal(state.tournament.pendingPlayers[0].elo, 1520);
  assert.equal(state.tournament.pendingPlayers.length, 1);
});

// =============================================================================
// 12. Final round
// =============================================================================

test('12: advancing past totalRounds is rejected with a clear error', () => {
  const state = runningFourPlayerState({ totalRounds: 1 });
  assert.throws(() => advanceTournamentRound(state), /already reached its final round/);
});

// =============================================================================
// 13-14. Rejections / atomicity
// =============================================================================

test('13: an EMPTY application throws', () => {
  assert.throws(() => advanceTournamentRound(createApplicationState()), /no tournament/);
});

test('13: a CONFIGURED_PRE_START (started: false) application throws', () => {
  const config = fixedConfig();
  const preStart = createApplicationState({
    tournament: createTournamentState({
      started: false, config, tournamentConfig: { title: 'Club Night', ...config },
      players: [], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0
    })
  });
  assert.throws(() => advanceTournamentRound(preStart), /not started/);
});

test('13: a missing current round throws', () => {
  const state = runningFourPlayerState();
  const broken = { ...state, tournament: { ...state.tournament, currentRound: 5 } };
  assert.throws(() => advanceTournamentRound(broken), /round 5 does not exist/);
});

// =============================================================================
// Pairing failure atomicity (Codex follow-up) — a NATURALLY reachable
// no-legal-bye scenario, not an artificial fixture.
// =============================================================================
//
// A 3-player tournament (an odd count that never changes) naturally produces
// a rotating bye — each player gets exactly one bye across three rounds
// (whoever the standings-driven bye-selection would pick each time in real
// play; hand-built here for a deterministic fixture, but this exact
// rotation is exactly what real accumulated play over 3 rounds with a fixed
// odd headcount produces). By Round 4, all three players have already had a
// bye, so whitepaper §9.2 makes the next bye illegal — generatePairings()
// legitimately returns null. This is the same "no legal bye" condition
// characterized as reachable-through-ordinary-play in this command's own
// header comment (unlike startTournament()'s Round-1 case).

const threePlayerRotatingByeState = () => {
  const config = fixedConfig();
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 }
  ];
  const bye = (id, elo) => ({ id: `bye-${id}`, p1: { id, elo }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, tbl: 1, format: 'fixed_rack' });
  const played = (id, name, p1id, p1elo, p2id, p2elo) => ({ id: name, p1: { id: p1id, elo: p1elo }, p2: { id: p2id, elo: p2elo }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 2, format: 'fixed_rack' });

  return createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: { title: 'Odd Trio', ...config },
      players: roster.map(({ id, name, elo }) => createPlayer({ id, name, elo })),
      roster,
      // Two pending players (not one): a single pending player would make
      // Round 4's total headcount even (3 existing + 1 = 4), needing no bye
      // at all. With two, the total stays odd (3 + 2 = 5) — and since a
      // newly-promoted player is always bye-protected for the round they
      // join (joinedRound === roundNum), BOTH new players are ineligible
      // for the bye too, alongside all three existing (already-bye) players
      // — genuinely nobody is eligible, reproducing the natural failure.
      pendingPlayers: [{ id: 4, name: 'Delta', elo: 1500 }, { id: 5, name: 'Echo', elo: 1480 }],
      rounds: {
        1: [played(1, 'r1m1', 1, 1600, 2, 1500), bye(3, 1550)], // Charlie's bye
        2: [played(2, 'r2m1', 2, 1500, 3, 1550), bye(1, 1600)], // Alpha's bye
        3: [played(3, 'r3m1', 1, 1600, 3, 1550), bye(2, 1500)]  // Bravo's bye — now all three have had one
      },
      currentRound: 3,
      totalRounds: 5
    }),
    preAdvanceSnapshot: createPreAdvanceSnapshot({
      tournament: { players: [{ id: 1, name: 'Alpha', elo: 1600 }], totalRounds: 5 },
      allRounds: { 1: [] },
      currentRound: 1,
      viewingRound: 1,
      pendingPlayers: []
    })
  });
};

test('a naturally reachable no-legal-bye failure (every player already had a bye) is atomic: input, pendingPlayers, and any prior preAdvanceSnapshot all remain unchanged', () => {
  const state = threePlayerRotatingByeState();
  const snapshot = JSON.parse(JSON.stringify(state));

  assert.throws(() => advanceTournamentRound(state), /no legal bye available/);

  assert.deepEqual(state, snapshot);
  assert.deepEqual(state.tournament.pendingPlayers, snapshot.tournament.pendingPlayers);
  assert.deepEqual(state.preAdvanceSnapshot, snapshot.preAdvanceSnapshot);
});

test('the same no-legal-bye failure is atomic at the store level', () => {
  const store = createTournamentStore(threePlayerRotatingByeState());
  const before = store.getState();

  assert.throws(() => store.advanceTournamentRound(), /no legal bye available/);

  assert.deepEqual(store.getState(), before);
});

test('14: does not mutate its ApplicationState input', () => {
  const state = runningFourPlayerState();
  const snapshot = JSON.parse(JSON.stringify(state));
  advanceTournamentRound(state);
  assert.deepEqual(state, snapshot);
});

test('14: a failed advance leaves the input completely unchanged', () => {
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }
  ];
  const state = runningFourPlayerState({ round1 });
  const snapshot = JSON.parse(JSON.stringify(state));
  assert.throws(() => advanceTournamentRound(state));
  assert.deepEqual(state, snapshot);
});

test('the result is a valid canonical ApplicationState', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  assert.deepEqual(validateApplicationState(next), { valid: true, errors: [] });
});

// =============================================================================
// 15-16. Fixed-rack / 14.1
// =============================================================================

test('15: fixed-rack advancement produces fixed_rack Round 2 matches', () => {
  const state = runningFourPlayerState();
  const next = advanceTournamentRound(state);
  next.tournament.rounds[2].forEach((m) => assert.equal(m.format, 'fixed_rack'));
});

test('16: 14.1 advancement produces straight_pool_14_1 Round 2 matches with target/points fields', () => {
  const config = spConfig();
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: true, cancelled: false, bye: false, tbl: 1, format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4 }
  ];
  const state = createApplicationState({
    tournament: createTournamentState({
      started: true, config, tournamentConfig: { title: '14.1 Club', ...config },
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1700 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }],
      pendingPlayers: [], rounds: { 1: round1 }, currentRound: 1, totalRounds: 4
    })
  });
  const next = advanceTournamentRound(state);
  const round2 = next.tournament.rounds[2];
  assert.equal(round2.length, 1);
  assert.equal(round2[0].format, 'straight_pool_14_1');
  assert.equal(typeof round2[0].target, 'number');
  assert.equal(round2[0].p1Points, 0);
});

// =============================================================================
// 17. Multiple sequential advances
// =============================================================================

test('17: multiple sequential advances (Round 1 -> 2 -> 3) each generate only the new round', () => {
  const state = runningFourPlayerState({ totalRounds: 3 });
  const afterRound2 = advanceTournamentRound(state);

  // Complete Round 2 (whatever pairing resulted) before advancing again.
  const round2Completed = {
    ...afterRound2,
    tournament: {
      ...afterRound2.tournament,
      rounds: {
        ...afterRound2.tournament.rounds,
        2: afterRound2.tournament.rounds[2].map((m) => ({ ...m, r1: 4, r2: 2, done: true }))
      }
    }
  };

  const afterRound3 = advanceTournamentRound(round2Completed);
  assert.equal(afterRound3.tournament.currentRound, 3);
  assert.ok(afterRound3.tournament.rounds[3]);
  // Rounds 1 and 2 remain exactly as they were before this second advance.
  assert.deepEqual(afterRound3.tournament.rounds[1], round2Completed.tournament.rounds[1]);
  assert.deepEqual(afterRound3.tournament.rounds[2], round2Completed.tournament.rounds[2]);
});

// =============================================================================
// Canonical-world recalculation necessity
// =============================================================================

test('a round completed without an intervening recalculation still has correct standings by the time of advancement, thanks to the internal recalculation safety net', () => {
  // Simulates a canonical-world gap recordMatchResult() cannot itself close
  // (e.g. a direct store.replaceState()/updateState() write bypassing the
  // command layer): tournament.players is deliberately left in a stale,
  // never-recalculated shape even though Round 1's match is done.
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  const config = fixedConfig();
  const round1 = [{ id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }];
  const state = createApplicationState({
    tournament: createTournamentState({
      started: true, config, tournamentConfig: { title: 'Club Night', ...config },
      // tournament.players deliberately left in the raw post-startTournament transient shape (never recalculated).
      players: [
        { id: 1, name: 'Alpha', elo: 1600, mp: 0, perf: 0, games: 0, opps: [], removed: false, joinedRound: 1 },
        { id: 2, name: 'Bravo', elo: 1500, mp: 0, perf: 0, games: 0, opps: [], removed: false, joinedRound: 1 }
      ],
      roster, pendingPlayers: [], rounds: { 1: round1 }, currentRound: 1, totalRounds: 4
    })
  });
  const next = advanceTournamentRound(state);
  const alpha = next.tournament.players.find((p) => p.id === 1);
  assert.equal(alpha.mp, 1); // correctly reflects the win despite no prior recalc having run
  assert.equal(alpha.games, 1);
});

// =============================================================================
// Composition with the application store
// =============================================================================

test('composes with tournamentStore.updateState() to commit an advance', () => {
  const store = createTournamentStore(runningFourPlayerState());
  store.updateState((current) => advanceTournamentRound(current));
  const state = store.getState();
  assert.equal(state.tournament.currentRound, 2);
});

test('store.advanceTournamentRound() commits a successful advance', () => {
  const store = createTournamentStore(runningFourPlayerState());
  store.advanceTournamentRound();
  assert.equal(store.getState().tournament.currentRound, 2);
});

test('a failed store.advanceTournamentRound() (incomplete round) throws and leaves store state completely unchanged', () => {
  const round1 = [
    { id: 'm1', p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }
  ];
  const store = createTournamentStore(runningFourPlayerState({ round1 }));
  const before = store.getState();
  assert.throws(() => store.advanceTournamentRound(), /must be completed or cancelled/);
  assert.deepEqual(store.getState(), before);
});

test('assignMatchTable() and recordMatchResult() still work normally on a store after advanceTournamentRound()', () => {
  const store = createTournamentStore(runningFourPlayerState());
  store.advanceTournamentRound();
  const matchId = store.getState().tournament.rounds[2][0].id;
  store.assignMatchTable({ roundNumber: 2, matchId, table: 'Court 9' });
  assert.equal(store.getState().tournament.rounds[2][0].tbl, 'Court 9');
  const next = recordMatchResult(store.getState(), { roundNumber: 2, matchId, r1: 4, r2: 2 });
  assert.equal(next.tournament.rounds[2][0].done, true);
});
