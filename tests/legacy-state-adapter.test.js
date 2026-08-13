import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplicationStateFromLegacy } from '../src/application/legacyStateAdapter.js';
import { validateApplicationState } from '../src/domain/tournamentModel.js';

const baseConfig = () => ({
  d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 4,
  use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15,
  ranking_system: 'classic', use_rank: false, format: 'fixed_rack',
  straightPool: {
    enabled: false, label: 'GBR_14.1 Experimental', startTarget: 40, tieringStartsRound: 2,
    tierTargets: [50, 40, 30], targetReference: 40, useTargetScaledK: true, k_14_1: 20,
    marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10, standingsOrder: 'mp_perf_npd'
  }
});

const steadyStatePlayer = (id, name, elo, overrides = {}) => ({
  id, name, elo, mp: 0, perf: 0, perfCount: 0, games: 0, opps: [],
  rp: 0, racksWon: 0, racksLost: 0, pointsFor: 0, pointsAgainst: 0,
  inningsTotal: 0, npd: 0, hs: 0, hgd: 0, removed: false, joinedRound: 1,
  ...overrides
});

// ---------------------------------------------------------------------------
// 1. Normal fixed-rack running tournament
// ---------------------------------------------------------------------------

test('1: a normal fixed-rack running tournament maps correctly', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const p1 = steadyStatePlayer(1, 'Alpha', 1613.28);
  const p2 = steadyStatePlayer(2, 'Bravo', 1586.72);
  const tournament = { players: [p1, p2], totalRounds: 4 };
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  const allRounds = {
    1: [{ id: 100, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }]
  };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: roster, pendingPlayers: [], allRounds, currentRound: 1, preAdvanceSnapshot: null
  });

  assert.deepEqual(validateApplicationState(state), { valid: true, errors: [] });
  assert.equal(state.tournament.config.format, 'fixed_rack');
  assert.equal(state.tournament.players.length, 2);
  assert.equal(state.tournament.rounds[1][0].format, 'fixed_rack');
  assert.equal(state.tournament.currentRound, 1);
  assert.equal(state.tournament.totalRounds, 4);
  assert.equal(state.preAdvanceSnapshot, null);
});

// ---------------------------------------------------------------------------
// 2. Experimental 14.1 running tournament
// ---------------------------------------------------------------------------

test('2: an experimental 14.1 running tournament maps correctly', () => {
  const config = { ...baseConfig(), format: 'straight_pool_14_1', straightPool: { ...baseConfig().straightPool, enabled: true } };
  const tournamentConfig = { title: '14.1 Club Championship', ...config };
  const p1 = steadyStatePlayer(1, 'Alpha', 1831);
  const p2 = steadyStatePlayer(2, 'Bravo', 1469);
  const tournament = { players: [p1, p2], totalRounds: 5 };
  const allRounds = {
    1: [{
      id: 200, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: true, cancelled: false, bye: false,
      tbl: '304', format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
    }]
  };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }],
    pendingPlayers: [], allRounds, currentRound: 1
  });

  assert.deepEqual(validateApplicationState(state), { valid: true, errors: [] });
  assert.equal(state.tournament.config.format, 'straight_pool_14_1');
  assert.equal(state.tournament.rounds[1][0].target, 30);
  assert.equal(state.tournament.rounds[1][0].p1Points, 30);
});

// ---------------------------------------------------------------------------
// 3. config and tournamentConfig remain independent
// ---------------------------------------------------------------------------

test('3: config and tournamentConfig remain independent (a mid-tournament settings edit is preserved as a real divergence)', () => {
  const setupConfig = baseConfig();
  const liveConfig = { ...baseConfig(), d: 350, k_m: 25 }; // "Tournament Settings" modal edit, tournamentConfig untouched
  const tournamentConfig = { title: 'Club Night', ...setupConfig };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };

  const state = captureApplicationStateFromLegacy({
    config: liveConfig, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 0
  });

  assert.equal(state.tournament.config.d, 350);
  assert.equal(state.tournament.tournamentConfig.d, 330);
  assert.notEqual(state.tournament.config.d, state.tournament.tournamentConfig.d);
});

// ---------------------------------------------------------------------------
// 4. global roster and tournament.players remain independent
// ---------------------------------------------------------------------------

test('4: global roster and tournament.players remain independent (a pending player is in the roster but not yet promoted)', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 } // added via addPlayerToTournament(), not yet in tournament.players
  ];

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: roster, pendingPlayers: [{ id: 3, name: 'Charlie', elo: 1550 }], allRounds: {}, currentRound: 1
  });

  assert.equal(state.tournament.players.length, 2);
  assert.equal(state.tournament.roster.length, 3);
  assert.equal(state.tournament.roster.some((p) => p.id === 3), true);
  assert.equal(state.tournament.players.some((p) => p.id === 3), false);
});

// ---------------------------------------------------------------------------
// 5. pending players survive mapping
// ---------------------------------------------------------------------------

test('5: pending players survive mapping unchanged', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const pending = [{ id: 5, name: 'Delta', elo: 1450 }];

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], pendingPlayers: pending, allRounds: {}, currentRound: 1
  });

  assert.deepEqual(state.tournament.pendingPlayers, pending);
});

// ---------------------------------------------------------------------------
// 6. allRounds becomes canonical Tournament.rounds
// ---------------------------------------------------------------------------

test('6: allRounds becomes canonical Tournament.rounds', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const allRounds = { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }] };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }], allRounds, currentRound: 1
  });

  assert.equal('rounds' in state.tournament, true);
  assert.equal('allRounds' in state.tournament, false);
  assert.deepEqual(state.tournament.rounds, allRounds);
});

// ---------------------------------------------------------------------------
// 7. preAdvanceSnapshot retains its actual legacy allRounds field
// ---------------------------------------------------------------------------

test('7: preAdvanceSnapshot retains its actual legacy allRounds field (never renamed to rounds)', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const legacyPreAdvanceSnapshot = {
    tournament: { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 },
    allRounds: { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false }] },
    currentRound: 1,
    viewingRound: 1,
    pendingPlayers: []
  };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 2,
    preAdvanceSnapshot: legacyPreAdvanceSnapshot
  });

  assert.equal('allRounds' in state.preAdvanceSnapshot, true);
  assert.equal('rounds' in state.preAdvanceSnapshot, false);
  assert.equal(state.preAdvanceSnapshot.allRounds[1][0].r1, 4);
  assert.equal(state.preAdvanceSnapshot.viewingRound, 1);
});

// ---------------------------------------------------------------------------
// 8. Manual match without format remains without format
// ---------------------------------------------------------------------------

test('8: a Manual Pairing Editor match without a format field remains without one', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  // Mirrors performApplyManualPairings()'s actual returned shape: no `format` key.
  const manualMatch = { id: 1755000000000, p1: { id: 1, name: 'Alpha', elo: 1600 }, p2: { id: 2, name: 'Bravo', elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1 };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
    allRounds: { 1: [manualMatch] }, currentRound: 1
  });

  assert.equal('format' in state.tournament.rounds[1][0], false);
  assert.deepEqual(validateApplicationState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// 9. Both bye representations survive unchanged
// ---------------------------------------------------------------------------

test('9: both legacy bye encodings survive unchanged, unmerged', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500), steadyStatePlayer(3, 'Charlie', 1550)], totalRounds: 4 };
  const createPairingsBye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'fixed_rack' };
  const manualEditorBye = { id: 2, p1: { id: 3, elo: 1550 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 6, r2: 0, done: true, cancelled: false, bye: true, tbl: 2 };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament,
    players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }, { id: 3, name: 'Charlie', elo: 1550 }],
    allRounds: { 1: [createPairingsBye, manualEditorBye] }, currentRound: 1
  });

  const [mappedCreatePairingsBye, mappedManualEditorBye] = state.tournament.rounds[1];
  assert.deepEqual({ r1: mappedCreatePairingsBye.r1, r2: mappedCreatePairingsBye.r2 }, { r1: 0, r2: 0 });
  assert.deepEqual({ r1: mappedManualEditorBye.r1, r2: mappedManualEditorBye.r2 }, { r1: 6, r2: 0 });
  assert.equal(mappedCreatePairingsBye.bye, true);
  assert.equal(mappedManualEditorBye.bye, true);
  assert.equal('format' in mappedManualEditorBye, false);
});

// ---------------------------------------------------------------------------
// 10. Transient player shapes survive without unwanted normalization
// ---------------------------------------------------------------------------

test('10: a mid-nextRound() promoted player (missing rp/14.1 aggregates) is not silently normalized', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const promotedPlayer = {
    id: 4, name: 'Delta', elo: 1500, mp: 0, perf: 0, perfCount: 0, games: 0,
    racksWon: 0, racksLost: 0, opps: [], removed: false, joinedRound: 2, avgPerf: 0
  };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), promotedPlayer], totalRounds: 4 };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 4, name: 'Delta', elo: 1500 }], allRounds: {}, currentRound: 2
  });

  const mappedPromotedPlayer = state.tournament.players.find((p) => p.id === 4);
  assert.equal('rp' in mappedPromotedPlayer, false);
  assert.equal('npd' in mappedPromotedPlayer, false);
  assert.equal(mappedPromotedPlayer.avgPerf, 0);
});

// ---------------------------------------------------------------------------
// 11. No shared mutable references with the supplied legacy inputs
// ---------------------------------------------------------------------------

test('11: the captured snapshot does not share mutable object/array references with the legacy inputs', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const p1 = steadyStatePlayer(1, 'Alpha', 1600);
  const tournament = { players: [p1], totalRounds: 4 };
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }];
  const allRounds = { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }] };

  const state = captureApplicationStateFromLegacy({ config, tournamentConfig, tournament, players: roster, allRounds, currentRound: 1 });

  // Mutate the ORIGINAL legacy inputs after capture.
  p1.elo = 9999;
  p1.opps.push(999);
  roster.push({ id: 99, name: 'Injected', elo: 1000 });
  allRounds[1][0].r1 = 0;
  allRounds[1].push({ id: 2, p1: { id: 1 }, p2: { id: 2 }, r1: 1, r2: 1, done: true, cancelled: false, bye: false });
  config.d = 1;

  assert.equal(state.tournament.players[0].elo, 1600);
  assert.deepEqual(state.tournament.players[0].opps, []);
  assert.equal(state.tournament.roster.length, 1);
  assert.equal(state.tournament.rounds[1][0].r1, 4);
  assert.equal(state.tournament.rounds[1].length, 1);
  assert.equal(state.tournament.config.d, 330);
});

// ---------------------------------------------------------------------------
// 12. Produced state passes existing ApplicationState validation
// ---------------------------------------------------------------------------

test('12: the produced state always passes validateApplicationState(), including the null/no-tournament-yet case', () => {
  const noTournamentYet = captureApplicationStateFromLegacy({});
  assert.deepEqual(noTournamentYet, { tournament: null, preAdvanceSnapshot: null });
  assert.deepEqual(validateApplicationState(noTournamentYet), { valid: true, errors: [] });

  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const withTournament = captureApplicationStateFromLegacy({ config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 0 });
  assert.deepEqual(validateApplicationState(withTournament), { valid: true, errors: [] });
});

test('captureApplicationStateFromLegacy throws a clear error for structurally invalid legacy input', () => {
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  assert.throws(
    () => captureApplicationStateFromLegacy({ config: baseConfig(), tournamentConfig: null, tournament, players: [], allRounds: {}, currentRound: 0 }),
    /invalid ApplicationState/
  );
});

// ---------------------------------------------------------------------------
// State-mode matrix (A-E): the three distinct current legacy lifecycle
// states — EMPTY, CONFIGURED_PRE_START, RUNNING — plus the two RUNNING
// variants the task calls out explicitly (with/without an undo snapshot,
// and with config/tournamentConfig divergence).
// ---------------------------------------------------------------------------

test('A: completely empty application state maps to tournament: null', () => {
  const state = captureApplicationStateFromLegacy({});
  assert.deepEqual(state, { tournament: null, preAdvanceSnapshot: null });
  assert.deepEqual(validateApplicationState(state), { valid: true, errors: [] });
});

test('B: configured-but-not-started event (tournament === null, tournamentConfig !== null) preserves configuration and roster instead of collapsing to tournament: null', () => {
  // Production-shaped: an event has been configured and players registered,
  // but "Start Tournament" has not been clicked — startTournament() has not
  // run, so legacy `tournament` is still null while `tournamentConfig` is
  // already set.
  const config = baseConfig();
  const tournamentConfig = { title: 'Friday Night Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 } // registered via addPlayerToTournament() before start
  ];
  // addPlayerToTournament() adds to both `players` and `pendingPlayers`
  // unconditionally, and startTournament() never clears pendingPlayers — so
  // a pre-start pendingPlayers list mirroring recently-registered players is
  // real, current, producible state, not a hypothetical.
  const pendingPlayers = [{ id: 3, name: 'Charlie', elo: 1550 }];

  const state = captureApplicationStateFromLegacy({
    config,
    tournamentConfig,
    tournament: null,
    players: roster,
    pendingPlayers,
    allRounds: {},
    currentRound: 0
  });

  assert.notEqual(state.tournament, null);
  assert.deepEqual(validateApplicationState(state), { valid: true, errors: [] });
  // started: false — Round 1 has not started, even though the event is fully configured.
  assert.equal(state.tournament.started, false);
  // Configuration and roster survive — this is the bug being fixed.
  assert.equal(state.tournament.tournamentConfig.title, 'Friday Night Championship');
  assert.equal(state.tournament.config.d, 330);
  assert.deepEqual(state.tournament.roster, roster);
  assert.deepEqual(state.tournament.pendingPlayers, pendingPlayers);
  // No tournament.players yet — nobody has "joined" as an accumulating
  // participant; inventing participant records here would fabricate state.
  assert.deepEqual(state.tournament.players, []);
  // totalRounds is read from config.default_rounds — the exact source
  // startTournament() itself uses when it eventually creates `tournament`.
  assert.equal(state.tournament.totalRounds, config.default_rounds);
  assert.equal(state.tournament.currentRound, 0);
  assert.equal(state.preAdvanceSnapshot, null);
});

test('C: a running tournament maps its own players/totalRounds (unchanged from before this correction)', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1613.28), steadyStatePlayer(2, 'Bravo', 1586.72)], totalRounds: 6 };
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];

  const state = captureApplicationStateFromLegacy({ config, tournamentConfig, tournament, players: roster, allRounds: {}, currentRound: 1 });

  assert.equal(state.tournament.started, true); // legacy tournament !== null -> started
  assert.equal(state.tournament.players.length, 2);
  assert.equal(state.tournament.totalRounds, 6); // from tournament.totalRounds, NOT config.default_rounds (4)
  assert.notEqual(state.tournament.totalRounds, config.default_rounds);
});

test('D: a running tournament with a preAdvanceSnapshot maps both independently', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const legacyPreAdvanceSnapshot = {
    tournament: { players: [steadyStatePlayer(1, 'Alpha', 1613.28)], totalRounds: 4 },
    allRounds: { 1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false }] },
    currentRound: 1,
    viewingRound: 1,
    pendingPlayers: []
  };

  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: { 2: [] }, currentRound: 2,
    preAdvanceSnapshot: legacyPreAdvanceSnapshot
  });

  assert.notEqual(state.tournament, null);
  assert.notEqual(state.preAdvanceSnapshot, null);
  assert.equal(state.tournament.started, true); // undo restores a RUNNING tournament, still started
  assert.equal(state.tournament.currentRound, 2);
  assert.equal(state.preAdvanceSnapshot.currentRound, 1);
  assert.equal(state.preAdvanceSnapshot.allRounds[1][0].r1, 4);
});

test('E: a running tournament with config/tournamentConfig divergence maps both independently', () => {
  const setupConfig = baseConfig();
  const liveConfig = { ...baseConfig(), d: 350 };
  const tournamentConfig = { title: 'Club Night', ...setupConfig };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };

  const state = captureApplicationStateFromLegacy({ config: liveConfig, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 1 });

  assert.equal(state.tournament.started, true);
  assert.equal(state.tournament.config.d, 350);
  assert.equal(state.tournament.tournamentConfig.d, 330);
});

// ---------------------------------------------------------------------------
// F. started lifecycle mapping (M2K-A) — dedicated coverage across all three
// legacy modes, distinct from the state-mode matrix above.
// ---------------------------------------------------------------------------

test('F1: EMPTY legacy state still maps to tournament: null (started is not applicable)', () => {
  const state = captureApplicationStateFromLegacy({});
  assert.equal(state.tournament, null);
});

test('F2: CONFIGURED_PRE_START legacy state maps to started: false', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 0
  });
  assert.notEqual(state.tournament, null);
  assert.equal(state.tournament.started, false);
});

test('F3: RUNNING legacy state maps to started: true', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const state = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 1
  });
  assert.equal(state.tournament.started, true);
});
