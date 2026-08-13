import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplicationStateFromLegacy, projectApplicationStateToLegacy } from '../src/application/legacyStateAdapter.js';
import {
  createApplicationState,
  createConfig,
  createMatch,
  createPlayer,
  createPreAdvanceSnapshot,
  createTournamentState,
  validateApplicationState
} from '../src/domain/tournamentModel.js';

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

// A round trip through both directions, starting from raw legacy-shaped input.
const roundTripLegacy = (legacyInput) => projectApplicationStateToLegacy(captureApplicationStateFromLegacy(legacyInput));

// =============================================================================
// projectApplicationStateToLegacy — basic contract
// =============================================================================

test('throws a clear error for invalid canonical input, without mutating it', () => {
  const invalid = { tournament: 'not-an-object' };
  const snapshot = JSON.parse(JSON.stringify(invalid));
  assert.throws(() => projectApplicationStateToLegacy(invalid), /invalid ApplicationState/);
  assert.deepEqual(invalid, snapshot);
});

test('EMPTY canonical state projects to the actual EMPTY legacy shape', () => {
  const legacy = projectApplicationStateToLegacy(createApplicationState());
  assert.deepEqual(legacy, {
    tournamentConfig: null,
    tournament: null,
    players: [],
    pendingPlayers: [],
    allRounds: {},
    currentRound: 0,
    preAdvanceSnapshot: null
  });
  // `config` is deliberately absent — canonical EMPTY state has no config to project.
  assert.equal('config' in legacy, false);
});

test('the projected legacy tournament object never carries `started` (legacy represents lifecycle via nullity only)', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const legacy = projectApplicationStateToLegacy(createApplicationState({
    tournament: createTournamentState({ started: true, players: [p1], rounds: {}, currentRound: 1 })
  }));
  assert.notEqual(legacy.tournament, null);
  assert.equal('started' in legacy.tournament, false);
  assert.deepEqual(Object.keys(legacy.tournament).sort(), ['players', 'totalRounds']);
});

test('CONFIGURED_PRE_START projects to legacy tournament: null, not a fabricated tournament object', () => {
  const config = createConfig();
  const legacy = projectApplicationStateToLegacy(createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Friday Night Championship', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  }));
  assert.equal(legacy.tournament, null);
});

test('cloning / reference isolation: mutating the projected output does not mutate the canonical input', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const applicationState = createApplicationState({
    tournament: createTournamentState({
      started: true,
      players: [p1],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: { 1: [createMatch({ id: 1, p1, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' })] },
      currentRound: 1
    }),
    preAdvanceSnapshot: createPreAdvanceSnapshot({
      tournament: { players: [p1], totalRounds: 4 },
      allRounds: { 1: [] },
      currentRound: 1,
      viewingRound: 1,
      pendingPlayers: []
    })
  });
  const snapshot = JSON.parse(JSON.stringify(applicationState));

  const legacy = projectApplicationStateToLegacy(applicationState);
  legacy.config = { mutated: true };
  legacy.players.push({ id: 99, name: 'Injected', elo: 1 });
  legacy.tournament.players[0].elo = 9999;
  legacy.tournament.players.push({ id: 100 });
  legacy.allRounds[1][0].r1 = 0;
  legacy.preAdvanceSnapshot.currentRound = 999;

  assert.deepEqual(applicationState, snapshot);
});

// =============================================================================
// LEGACY -> CANONICAL -> LEGACY round trips (Part 12)
// =============================================================================

test('1: EMPTY round-trips to the same EMPTY legacy shape', () => {
  const projected = roundTripLegacy({});
  assert.deepEqual(projected, {
    tournamentConfig: null, tournament: null, players: [], pendingPlayers: [],
    allRounds: {}, currentRound: 0, preAdvanceSnapshot: null
  });
});

test('2: CONFIGURED_PRE_START round-trips config/tournamentConfig/roster/pendingPlayers/currentRound', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Friday Night Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 }
  ];
  const pendingPlayers = [{ id: 3, name: 'Charlie', elo: 1550 }];

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers, allRounds: {}, currentRound: 0
  });

  assert.equal(projected.tournament, null);
  assert.deepEqual(projected.config, config);
  assert.deepEqual(projected.tournamentConfig, tournamentConfig);
  assert.deepEqual(projected.players, roster);
  assert.deepEqual(projected.pendingPlayers, pendingPlayers);
  assert.deepEqual(projected.allRounds, {});
  assert.equal(projected.currentRound, 0);
});

test('3: RUNNING fixed-rack round-trips tournament/config/roster/allRounds/currentRound', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1613.28), steadyStatePlayer(2, 'Bravo', 1586.72)], totalRounds: 4 };
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  const allRounds = {
    1: [{ id: 100, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 5, r2: 1, done: true, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' }]
  };

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: roster, pendingPlayers: [], allRounds, currentRound: 1 });

  assert.deepEqual(projected.tournament, tournament);
  assert.deepEqual(projected.config, config);
  assert.deepEqual(projected.tournamentConfig, tournamentConfig);
  assert.deepEqual(projected.players, roster);
  assert.deepEqual(projected.allRounds, allRounds);
  assert.equal(projected.currentRound, 1);
});

test('4: RUNNING GBR_14.1 round-trips 14.1 match fields and config', () => {
  const config = { ...baseConfig(), format: 'straight_pool_14_1', straightPool: { ...baseConfig().straightPool, enabled: true } };
  const tournamentConfig = { title: '14.1 Club Championship', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1831), steadyStatePlayer(2, 'Bravo', 1469)], totalRounds: 5 };
  const allRounds = {
    1: [{
      id: 200, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: true, cancelled: false, bye: false,
      tbl: '304', format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
    }]
  };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament,
    players: [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }],
    pendingPlayers: [], allRounds, currentRound: 1
  });

  assert.deepEqual(projected.tournament, tournament);
  assert.equal(projected.config.format, 'straight_pool_14_1');
  assert.deepEqual(projected.allRounds, allRounds);
});

test('5: RUNNING with a preAdvanceSnapshot round-trips the snapshot exactly (allRounds key, no rename/injection)', () => {
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

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }],
    allRounds: { 2: [] }, currentRound: 2, preAdvanceSnapshot: legacyPreAdvanceSnapshot
  });

  assert.deepEqual(projected.preAdvanceSnapshot, legacyPreAdvanceSnapshot);
  assert.equal('allRounds' in projected.preAdvanceSnapshot, true);
  assert.equal('rounds' in projected.preAdvanceSnapshot, false);
  assert.equal('started' in projected.preAdvanceSnapshot, false);
});

test('6: diverged config/tournamentConfig both round-trip independently', () => {
  const setupConfig = baseConfig();
  const liveConfig = { ...baseConfig(), d: 350, k_m: 25 };
  const tournamentConfig = { title: 'Club Night', ...setupConfig };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };

  const projected = roundTripLegacy({ config: liveConfig, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], allRounds: {}, currentRound: 0 });

  assert.equal(projected.config.d, 350);
  assert.equal(projected.tournamentConfig.d, 330);
  assert.notEqual(projected.config.d, projected.tournamentConfig.d);
});

test('7: global roster and tournament.players remain independent through the round trip', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 } // in the roster, not yet promoted into tournament.players
  ];

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: roster, pendingPlayers: [{ id: 3, name: 'Charlie', elo: 1550 }], allRounds: {}, currentRound: 1 });

  assert.equal(projected.tournament.players.length, 2);
  assert.equal(projected.players.length, 3);
  assert.equal(projected.players.some((p) => p.id === 3), true);
  assert.equal(projected.tournament.players.some((p) => p.id === 3), false);
});

test('8: pendingPlayers round-trip unchanged', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600)], totalRounds: 4 };
  const pending = [{ id: 5, name: 'Delta', elo: 1450 }];

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }], pendingPlayers: pending, allRounds: {}, currentRound: 1 });

  assert.deepEqual(projected.pendingPlayers, pending);
});

test('9: a Manual Pairing Editor match without a format field round-trips without one', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const manualMatch = { id: 1755000000000, p1: { id: 1, name: 'Alpha', elo: 1600 }, p2: { id: 2, name: 'Bravo', elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1 };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
    allRounds: { 1: [manualMatch] }, currentRound: 1
  });

  assert.equal('format' in projected.allRounds[1][0], false);
  assert.deepEqual(projected.allRounds[1][0], manualMatch);
});

test('10: an automatic createPairings() match round-trips exactly', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const automaticMatch = { id: Date.now(), p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1, format: 'fixed_rack' };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
    allRounds: { 1: [automaticMatch] }, currentRound: 1
  });

  assert.deepEqual(projected.allRounds[1][0], automaticMatch);
});

test('11: both legacy bye encodings round-trip unchanged, unmerged', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(3, 'Charlie', 1550)], totalRounds: 4 };
  const createPairingsBye = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 0, r2: 0, done: true, cancelled: false, bye: true, format: 'fixed_rack' };
  const manualEditorBye = { id: 2, p1: { id: 3, elo: 1550 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, r1: 6, r2: 0, done: true, cancelled: false, bye: true, tbl: 2 };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament,
    players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 3, name: 'Charlie', elo: 1550 }],
    allRounds: { 1: [createPairingsBye, manualEditorBye] }, currentRound: 1
  });

  assert.deepEqual(projected.allRounds[1][0], createPairingsBye);
  assert.deepEqual(projected.allRounds[1][1], manualEditorBye);
});

test('12/13/14: numeric, raw-string, and blank table assignments all round-trip with their exact type', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const allRounds = {
    1: [
      { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 3, format: 'fixed_rack' },
      { id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 'Table B', format: 'fixed_rack' },
      { id: 3, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: '', format: 'fixed_rack' }
    ]
  };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament,
    players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
    allRounds, currentRound: 1
  });

  assert.equal(projected.allRounds[1][0].tbl, 3);
  assert.equal(typeof projected.allRounds[1][0].tbl, 'number');
  assert.equal(projected.allRounds[1][1].tbl, 'Table B');
  assert.equal(typeof projected.allRounds[1][1].tbl, 'string');
  assert.equal(projected.allRounds[1][2].tbl, '');
});

test('15: 14.1 target/points/innings/high-run values round-trip exactly', () => {
  const config = { ...baseConfig(), format: 'straight_pool_14_1' };
  const tournamentConfig = { title: '14.1 Club', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1700), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const match = {
    id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: true, cancelled: false, bye: false,
    format: 'straight_pool_14_1', target: 40, p1Points: 40, p2Points: 22, innings: 14, p1HighRun: 12, p2HighRun: 6
  };

  const projected = roundTripLegacy({
    config, tournamentConfig, tournament,
    players: [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }],
    allRounds: { 1: [match] }, currentRound: 1
  });

  assert.deepEqual(projected.allRounds[1][0], match);
});

test('16: removed/joinedRound fields round-trip exactly', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const withdrawn = steadyStatePlayer(1, 'Withdrawn', 1600, { removed: true });
  const lateJoiner = steadyStatePlayer(2, 'Late', 1500, { joinedRound: 3 });
  const tournament = { players: [withdrawn, lateJoiner], totalRounds: 4 };

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: [{ id: 1, name: 'Withdrawn', elo: 1600 }, { id: 2, name: 'Late', elo: 1500 }], allRounds: {}, currentRound: 2 });

  assert.equal(projected.tournament.players[0].removed, true);
  assert.equal(projected.tournament.players[1].joinedRound, 3);
});

test('17: a mid-nextRound() transient promoted-player shape round-trips without added fields', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const promotedPlayer = {
    id: 4, name: 'Delta', elo: 1500, mp: 0, perf: 0, perfCount: 0, games: 0,
    racksWon: 0, racksLost: 0, opps: [], removed: false, joinedRound: 2, avgPerf: 0
  };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), promotedPlayer], totalRounds: 4 };

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 4, name: 'Delta', elo: 1500 }], allRounds: {}, currentRound: 2 });

  const mappedPromotedPlayer = projected.tournament.players.find((p) => p.id === 4);
  assert.deepEqual(mappedPromotedPlayer, promotedPlayer);
  assert.equal('rp' in mappedPromotedPlayer, false);
});

test('18: round object keys survive JSON serialization and remain usable after the round trip', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const tournament = { players: [steadyStatePlayer(1, 'Alpha', 1600), steadyStatePlayer(2, 'Bravo', 1500)], totalRounds: 4 };
  const allRounds = {
    1: [{ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, cancelled: false, bye: false, format: 'fixed_rack' }],
    2: [{ id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, format: 'fixed_rack' }]
  };

  const projected = roundTripLegacy({ config, tournamentConfig, tournament, players: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }], allRounds, currentRound: 2 });

  assert.deepEqual(Object.keys(projected.allRounds).sort(), ['1', '2']);
  assert.equal(projected.allRounds[1][0].r1, 4); // numeric-key access still resolves via JS coercion
  assert.equal(projected.allRounds[2][0].done, false);
});

// =============================================================================
// CANONICAL -> LEGACY -> CANONICAL round trips (Part 13)
// =============================================================================

test('C->L->C 1: EMPTY preserves canonical meaning', () => {
  const canonical = createApplicationState();
  const legacy = projectApplicationStateToLegacy(canonical);
  const recaptured = captureApplicationStateFromLegacy(legacy);
  assert.deepEqual(recaptured, canonical);
});

test('C->L->C 2: CONFIGURED_PRE_START preserves config/tournamentConfig/roster/pendingPlayers/started', () => {
  const config = createConfig({ d: 400 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Friday Night Championship', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      pendingPlayers: [{ id: 2, name: 'Bravo', elo: 1500 }],
      rounds: {},
      currentRound: 0,
      totalRounds: config.default_rounds // NOT diverged in this test — see the dedicated divergence test below
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  const recaptured = captureApplicationStateFromLegacy(legacy);

  assert.equal(recaptured.tournament.started, false);
  assert.deepEqual(recaptured.tournament.config, canonical.tournament.config);
  assert.deepEqual(recaptured.tournament.tournamentConfig, canonical.tournament.tournamentConfig);
  assert.deepEqual(recaptured.tournament.roster, canonical.tournament.roster);
  assert.deepEqual(recaptured.tournament.pendingPlayers, canonical.tournament.pendingPlayers);
  assert.equal(recaptured.tournament.totalRounds, canonical.tournament.totalRounds); // not diverged here, so it matches
});

test('C->L->C 3: RUNNING preserves tournament/players/config/allRounds/started', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1613.28 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1586.72 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: true,
      players: [p1, p2],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' })] },
      currentRound: 1
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  const recaptured = captureApplicationStateFromLegacy(legacy);

  assert.equal(recaptured.tournament.started, true);
  assert.deepEqual(recaptured.tournament.players, canonical.tournament.players);
  assert.deepEqual(recaptured.tournament.roster, canonical.tournament.roster);
  assert.deepEqual(recaptured.tournament.rounds, canonical.tournament.rounds);
  assert.equal(recaptured.tournament.totalRounds, canonical.tournament.totalRounds);
});

test('C->L->C 4: RUNNING with a preAdvanceSnapshot preserves the snapshot', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const canonical = createApplicationState({
    tournament: createTournamentState({ started: true, players: [p1], rounds: {}, currentRound: 2 }),
    preAdvanceSnapshot: createPreAdvanceSnapshot({
      tournament: { players: [p1], totalRounds: 4 },
      allRounds: { 1: [] },
      currentRound: 1,
      viewingRound: 1,
      pendingPlayers: []
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  const recaptured = captureApplicationStateFromLegacy(legacy);

  assert.deepEqual(recaptured.preAdvanceSnapshot, canonical.preAdvanceSnapshot);
});

test('C->L->C 5: config/tournamentConfig divergence survives the round trip', () => {
  const setupConfig = createConfig({ d: 330 });
  const liveConfig = createConfig({ d: 350 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: true,
      config: liveConfig,
      tournamentConfig: { title: 'Club Night', ...setupConfig },
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      rounds: {},
      currentRound: 0
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  const recaptured = captureApplicationStateFromLegacy(legacy);

  assert.equal(recaptured.tournament.config.d, 350);
  assert.equal(recaptured.tournament.tournamentConfig.d, 330);
});

test('C->L->C 6: started: false is preserved', () => {
  const canonical = createApplicationState({
    tournament: createTournamentState({ started: false, players: [], rounds: {}, currentRound: 0 })
  });
  const recaptured = captureApplicationStateFromLegacy(projectApplicationStateToLegacy(canonical));
  assert.equal(recaptured.tournament.started, false);
});

test('C->L->C 7: started: true is preserved', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const canonical = createApplicationState({
    tournament: createTournamentState({ started: true, players: [p1], rounds: {}, currentRound: 1 })
  });
  const recaptured = captureApplicationStateFromLegacy(projectApplicationStateToLegacy(canonical));
  assert.equal(recaptured.tournament.started, true);
});

// ---------------------------------------------------------------------------
// CONFIGURED_PRE_START totalRounds REPRESENTABILITY (M2K-B follow-up)
// ---------------------------------------------------------------------------
//
// See the detailed note above projectApplicationStateToLegacy() in
// legacyStateAdapter.js. Current legacy pre-start state has no field to store
// totalRounds independently of config.default_rounds (there is no pre-start
// tournament object at all) — legacy startTournament() always reads
// config.default_rounds live. A real canonical CONFIGURED_PRE_START
// Tournament captured from actual legacy state always has
// totalRounds === config.default_rounds, so that case must project cleanly
// (test A). An artificially constructed canonical state where the two values
// have been made to disagree is NOT representable in current legacy
// pre-start state; rather than silently lose/rewrite/regenerate one of the
// two values, projection must fail loudly and leave the canonical input
// completely unchanged (test B).

test('A: a REPRESENTABLE pre-start Tournament (totalRounds === config.default_rounds) projects successfully and round-trips cleanly', () => {
  const config = createConfig({ default_rounds: 5 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Friday Night Championship', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0,
      totalRounds: 5 // matches config.default_rounds — the only value a real legacy capture ever produces
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.equal(legacy.tournament, null);
  assert.equal(legacy.config.default_rounds, 5);

  const recaptured = captureApplicationStateFromLegacy(legacy);
  assert.equal(recaptured.tournament.totalRounds, 5);
  assert.deepEqual(recaptured, canonical); // fully lossless for this representable case
});

test('B: a CONTRADICTORY pre-start Tournament (totalRounds !== config.default_rounds) is rejected, not silently resolved', () => {
  const config = createConfig({ default_rounds: 4 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Friday Night Championship', ...createConfig({ default_rounds: 6 }) },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0,
      totalRounds: 5 // contradicts config.default_rounds (4) — unrepresentable in current legacy pre-start state
    })
  });
  const snapshot = JSON.parse(JSON.stringify(canonical));

  assert.throws(
    () => projectApplicationStateToLegacy(canonical),
    /cannot project a CONFIGURED_PRE_START Tournament whose totalRounds .* differs from config\.default_rounds/
  );

  // Projection must not silently drop 5, silently rewrite either value, or
  // regenerate/mutate the canonical input on failure.
  assert.deepEqual(canonical, snapshot);
});

test('RUNNING: totalRounds may legitimately diverge from config.default_rounds — both are preserved independently, never synchronized', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const config = createConfig({ default_rounds: 4 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: true,
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [p1],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1,
      totalRounds: 5 // legitimately different — legacy tournament.totalRounds exists independently once running
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.equal(legacy.tournament.totalRounds, 5);
  assert.equal(legacy.config.default_rounds, 4);
  assert.notEqual(legacy.tournament.totalRounds, legacy.config.default_rounds); // not synchronized

  const recaptured = captureApplicationStateFromLegacy(legacy);
  assert.equal(recaptured.tournament.totalRounds, 5);
  assert.equal(recaptured.tournament.config.default_rounds, 4);
});

// =============================================================================
// PRE-START DIRECTOR EDIT PRESERVATION (Part 14)
// =============================================================================
//
// Canonical started:false state may be edited repeatedly before Round 1
// starts (M2K-A's pre-start editability). Projection must reflect whatever
// the CURRENT canonical values are — never reconstruct older/default values.

test('projection reflects an edited config while started stays false', () => {
  const originalConfig = createConfig({ d: 330 });
  const editedConfig = createConfig({ d: 400, max_games: 8 });
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config: editedConfig, // simulates a director's post-construction config edit via updateState()
      tournamentConfig: { title: 'Friday Night Championship', ...originalConfig },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.equal(legacy.config.d, 400);
  assert.equal(legacy.config.max_games, 8);
  // tournamentConfig is a separate, independently-edited value — untouched by the config edit.
  assert.equal(legacy.tournamentConfig.d, 330);
});

test('projection reflects an edited tournamentConfig while started stays false', () => {
  const config = createConfig();
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Saturday Night Championship', ...config }, // edited title
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.equal(legacy.tournamentConfig.title, 'Saturday Night Championship');
  assert.equal(legacy.config.d, config.d); // active config is a separate field, untouched
});

test('projection reflects edited roster/pendingPlayers while started stays false', () => {
  const config = createConfig();
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }], // roster grew
      pendingPlayers: [{ id: 2, name: 'Bravo', elo: 1500 }],
      rounds: {},
      currentRound: 0
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.equal(legacy.players.length, 2);
  assert.deepEqual(legacy.pendingPlayers, [{ id: 2, name: 'Bravo', elo: 1500 }]);
  // Nothing was rebuilt from defaults merely because started is false.
  assert.equal(legacy.config.d, config.d);
  assert.equal(legacy.tournamentConfig.title, 'Club Night');
});

test('projection reflects edited rounds/currentRound while started stays false (e.g. a manually pre-seeded round)', () => {
  const config = createConfig();
  const manualMatch = { id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 1 };
  const canonical = createApplicationState({
    tournament: createTournamentState({
      started: false,
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: { 1: [manualMatch] },
      currentRound: 0
    })
  });

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.deepEqual(legacy.allRounds, { 1: [manualMatch] });
  assert.equal(legacy.currentRound, 0);
  assert.equal(legacy.tournament, null); // still pre-start regardless of rounds content
});
