import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplicationStateFromLegacy, projectApplicationStateToLegacy } from '../src/application/legacyStateAdapter.js';
import { startTournament } from '../src/application/tournamentCommands.js';

// M2L cross-check (Part 16): a representative legacy CONFIGURED_PRE_START
// state, run through
//   captureApplicationStateFromLegacy() -> startTournament() -> projectApplicationStateToLegacy()
// Cross-checks the canonical compatibility path against behavior
// characterized from the legacy source (see the source-level characterization
// in tournamentCommands.js and src/domain/pairing.js, verified by direct
// inspection of PoolTournamentApp.jsx). This exercises the full adapter ->
// command -> projection boundary end to end, not just the pure command in
// isolation (already covered by tests/tournament-commands.test.js) — it is
// NOT an independently executable legacy oracle (no React/legacy component
// runs anywhere in this test file or this codebase's test suite), so it
// cannot and does not claim byte-for-byte equality against an independently
// run legacy implementation. Its assertions are only as accurate as the
// characterization they were written from.
//
// Byte-equality is not required for UI-only state (seedMethod/tableNumbers
// themselves, viewingRound, view) — those have no canonical home and are
// documented exclusions, not omissions.

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

test('fixed-rack: legacy pre-start -> canonical -> startTournament -> legacy matches characterized legacy behavior', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Friday Night Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 },
    { id: 4, name: 'Delta', elo: 1450 }
  ];
  const pendingPlayers = [{ id: 4, name: 'Delta', elo: 1450 }]; // registered pre-start; duplicates the roster

  const canonicalBefore = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers, allRounds: {}, currentRound: 0
  });
  assert.equal(canonicalBefore.tournament.started, false);

  const canonicalAfter = startTournament(canonicalBefore, { seedMethod: 'random' });
  assert.equal(canonicalAfter.tournament.started, true);

  const legacy = projectApplicationStateToLegacy(canonicalAfter);

  // tournament: { players, totalRounds } — a real non-null legacy tournament object.
  assert.notEqual(legacy.tournament, null);
  assert.equal(legacy.tournament.totalRounds, config.default_rounds);
  assert.equal(legacy.tournament.players.length, 4);
  assert.deepEqual(legacy.tournament.players.map((p) => p.id).sort(), [1, 2, 3, 4]);
  legacy.tournament.players.forEach((p) => {
    assert.equal(p.mp, 0);
    assert.equal(p.joinedRound, 1);
    assert.equal(p.removed, false);
  });

  // currentRound / Round 1.
  assert.equal(legacy.currentRound, 1);
  assert.deepEqual(Object.keys(legacy.allRounds), ['1']);
  assert.equal(legacy.allRounds[1].length, 2);
  legacy.allRounds[1].forEach((m) => assert.equal(m.format, 'fixed_rack'));

  // pendingPlayers: never cleared by startTournament(), duplication with the
  // roster preserved exactly as current legacy code leaves it.
  assert.deepEqual(legacy.pendingPlayers, pendingPlayers);

  // Global players (roster) / config / tournamentConfig untouched.
  assert.deepEqual(legacy.players, roster);
  assert.deepEqual(legacy.config, config);
  assert.deepEqual(legacy.tournamentConfig, tournamentConfig);

  // No undo snapshot is created by starting Round 1.
  assert.equal(legacy.preAdvanceSnapshot, null);
});

test('14.1: legacy pre-start -> canonical -> startTournament -> legacy stamps 14.1 targets on Round 1', () => {
  const config = { ...baseConfig(), format: 'straight_pool_14_1', straightPool: { ...baseConfig().straightPool, enabled: true } };
  const tournamentConfig = { title: '14.1 Club Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1700 },
    { id: 2, name: 'Bravo', elo: 1500 }
  ];

  const canonicalBefore = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  });
  const canonicalAfter = startTournament(canonicalBefore, { seedMethod: 'random' });
  const legacy = projectApplicationStateToLegacy(canonicalAfter);

  assert.equal(legacy.allRounds[1][0].format, 'straight_pool_14_1');
  assert.equal(typeof legacy.allRounds[1][0].target, 'number');
  assert.equal(legacy.allRounds[1][0].p1Points, 0);
  assert.equal(legacy.allRounds[1][0].innings, 0);
});

test('table assignment: explicit tableNumbers survive the full round trip into legacy allRounds', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];

  const canonicalBefore = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  });
  const canonicalAfter = startTournament(canonicalBefore, { seedMethod: 'random', tableNumbers: [11] });
  const legacy = projectApplicationStateToLegacy(canonicalAfter);

  assert.equal(legacy.allRounds[1][0].tbl, 11);
});

test('odd roster: a bye match with the FREILOS sentinel survives the full round trip', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Night', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 }
  ];

  const canonicalBefore = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  });
  const canonicalAfter = startTournament(canonicalBefore, { seedMethod: 'random' });
  const legacy = projectApplicationStateToLegacy(canonicalAfter);

  const byeMatch = legacy.allRounds[1].find((m) => m.bye);
  assert.ok(byeMatch);
  assert.deepEqual(byeMatch.p2, { id: 'bye', name: 'FREILOS', elo: 1300 });
});
