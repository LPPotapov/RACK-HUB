import assert from 'node:assert/strict';
import test from 'node:test';
import { captureApplicationStateFromLegacy, projectApplicationStateToLegacy } from '../src/application/legacyStateAdapter.js';
import { advanceTournamentRound, assignMatchTable, recordMatchResult, startTournament } from '../src/application/tournamentCommands.js';
import { validateApplicationState } from '../src/domain/tournamentModel.js';

// M2O — legacy <-> canonical workflow orchestration (fixed-rack, synthetic).
//
// Proves the FULL command chain executes correctly through the legacy
// compatibility boundary on both sides:
//
//   legacy-shaped state
//     -> captureApplicationStateFromLegacy()
//     -> startTournament() -> recordMatchResult() x N -> advanceTournamentRound()
//        (repeated across rounds, including a correction to an EARLIER round
//        after later rounds already exist)
//     -> projectApplicationStateToLegacy()
//     -> legacy-shaped state again
//
// This is deliberately NOT a unit test of any single command (those already
// exist per-command); it exists to catch integration errors between commands
// and the two adapter directions that isolated unit tests cannot catch —
// e.g. a field name mismatch between what a command writes and what the
// projector reads, or an accidental cross-round reference. No new
// production code was needed or added — this composes only existing,
// already-tested exports.

const baseConfig = () => ({
  d: 330, k_m: 30, k_r: 20, max_games: 6, default_rounds: 3,
  use_rp: true, rp_per_round: 10, rp_per_mp: 10, rp_elo_multiplier: 0.15,
  ranking_system: 'classic', use_rank: false, format: 'fixed_rack',
  straightPool: {
    enabled: false, label: 'GBR_14.1 Experimental', startTarget: 40, tieringStartsRound: 2,
    tierTargets: [50, 40, 30], targetReference: 40, useTargetScaledK: true, k_14_1: 20,
    marginWeight: 0.60, bpiWeight: 0.30, highRunWeight: 0.10, standingsOrder: 'mp_perf_npd'
  }
});

test('full command chain through the legacy boundary: configure -> capture -> start -> score R1 -> advance -> score R2 -> advance R3 -> correct R1 -> project back to legacy', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 },
    { id: 3, name: 'Charlie', elo: 1550 },
    { id: 4, name: 'Delta', elo: 1450 }
  ];

  // 1. Legacy-shaped CONFIGURED_PRE_START input, exactly as PoolTournamentApp.jsx would hold it.
  const legacyPreStart = {
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  };

  // 2. Capture into canonical.
  let canonical = captureApplicationStateFromLegacy(legacyPreStart);
  assert.equal(canonical.tournament.started, false);
  assert.deepEqual(validateApplicationState(canonical), { valid: true, errors: [] });

  // 3. Start the tournament (canonical command).
  canonical = startTournament(canonical, { seedMethod: 'random' });
  assert.equal(canonical.tournament.started, true);
  assert.equal(canonical.tournament.currentRound, 1);
  assert.equal(canonical.tournament.rounds[1].length, 2);

  // Assign a STRING table identifier to prove table-string preservation later.
  const round1FirstMatchId = canonical.tournament.rounds[1][0].id;
  canonical = assignMatchTable(canonical, { roundNumber: 1, matchId: round1FirstMatchId, table: 'Table A1' });

  // 4. Score every Round 1 match.
  canonical.tournament.rounds[1].forEach((m) => {
    canonical = recordMatchResult(canonical, { roundNumber: 1, matchId: m.id, r1: 4, r2: 2 });
  });
  canonical.tournament.rounds[1].forEach((m) => assert.equal(m.done, true));

  // 5. Advance to Round 2.
  canonical = advanceTournamentRound(canonical);
  assert.equal(canonical.tournament.currentRound, 2);
  const round1AfterFirstAdvance = canonical.tournament.rounds[1];

  // 6. Score every Round 2 match.
  canonical.tournament.rounds[2].forEach((m) => {
    canonical = recordMatchResult(canonical, { roundNumber: 2, matchId: m.id, r1: 3, r2: 3 });
  });

  // 7. Advance to Round 3 — this is the multi-round chain's second advance.
  canonical = advanceTournamentRound(canonical);
  assert.equal(canonical.tournament.currentRound, 3);
  assert.equal(canonical.tournament.rounds[1].length, 2);
  assert.equal(canonical.tournament.rounds[2].length, 2);
  assert.equal(canonical.tournament.rounds[3].length, 2);
  // Round 1 and Round 2 are untouched by the second advance.
  assert.deepEqual(canonical.tournament.rounds[1], round1AfterFirstAdvance);

  const round2BeforeCorrection = canonical.tournament.rounds[2];
  const round3BeforeCorrection = canonical.tournament.rounds[3];
  const snapshotBeforeCorrection = canonical.preAdvanceSnapshot;

  // 8. CORRECT an earlier (Round 1) result, after Round 2 and Round 3 both
  // already exist — must recalculate derived numbers WITHOUT touching any
  // later round's stored pairings/tables/scores, and without touching the
  // undo snapshot (which was captured at the Round-2->3 advance, unrelated
  // to this Round-1 correction).
  const correctedMatchId = canonical.tournament.rounds[1][0].id;
  canonical = recordMatchResult(canonical, { roundNumber: 1, matchId: correctedMatchId, r1: 2, r2: 4 });

  assert.deepEqual(canonical.tournament.rounds[2], round2BeforeCorrection);
  assert.deepEqual(canonical.tournament.rounds[3], round3BeforeCorrection);
  assert.deepEqual(canonical.preAdvanceSnapshot, snapshotBeforeCorrection);
  // The table string assigned back in step 3 survives the correction untouched.
  assert.equal(canonical.tournament.rounds[1].find((m) => m.id === round1FirstMatchId).tbl, 'Table A1');

  // 9. Project back to the legacy shape.
  const legacy = projectApplicationStateToLegacy(canonical);

  // ---- Parity checks ----
  assert.deepEqual(legacy.config, canonical.tournament.config);
  assert.deepEqual(legacy.tournamentConfig, canonical.tournament.tournamentConfig);
  assert.deepEqual(legacy.players, canonical.tournament.roster); // legacy global roster
  assert.notEqual(legacy.tournament, null);
  assert.deepEqual(legacy.tournament.players, canonical.tournament.players);
  assert.equal(legacy.tournament.totalRounds, canonical.tournament.totalRounds);
  assert.equal('started' in legacy.tournament, false); // no canonical-only field leaks in
  assert.deepEqual(legacy.allRounds, canonical.tournament.rounds);
  assert.equal(legacy.currentRound, 3);
  assert.deepEqual(legacy.pendingPlayers, []);
  assert.ok(legacy.preAdvanceSnapshot);
  assert.equal('rounds' in legacy.preAdvanceSnapshot, false); // never renamed from allRounds
  assert.equal('started' in legacy.preAdvanceSnapshot.tournament, false);

  // Table string survives projection.
  assert.equal(legacy.allRounds[1].find((m) => m.id === round1FirstMatchId).tbl, 'Table A1');

  // Corrected Round 1 result is reflected; later rounds are still untouched
  // in the PROJECTED legacy shape too (not just canonically).
  assert.equal(legacy.allRounds[1].find((m) => m.id === correctedMatchId).r1, 2);
  assert.deepEqual(legacy.allRounds[2], round2BeforeCorrection);
  assert.deepEqual(legacy.allRounds[3], round3BeforeCorrection);

  // 10. Re-capturing the projected legacy state reproduces the same canonical meaning.
  const recaptured = captureApplicationStateFromLegacy(legacy);
  assert.equal(recaptured.tournament.started, true);
  assert.deepEqual(recaptured.tournament.rounds, canonical.tournament.rounds);
  assert.equal(recaptured.tournament.currentRound, 3);
  assert.deepEqual(recaptured.tournament.players, canonical.tournament.players);
});

test('a pending player joining mid-tournament is promoted and survives capture -> commands -> project', () => {
  const config = baseConfig();
  const tournamentConfig = { title: 'Club Championship', ...config };
  const roster = [
    { id: 1, name: 'Alpha', elo: 1600 },
    { id: 2, name: 'Bravo', elo: 1500 }
  ];

  let canonical = captureApplicationStateFromLegacy({
    config, tournamentConfig, tournament: null, players: roster, pendingPlayers: [], allRounds: {}, currentRound: 0
  });
  canonical = startTournament(canonical, { seedMethod: 'random' });
  canonical.tournament.rounds[1].forEach((m) => {
    canonical = recordMatchResult(canonical, { roundNumber: 1, matchId: m.id, r1: 4, r2: 2 });
  });

  // A new player registers mid-tournament: addPlayerToTournament() legacy
  // behavior adds to BOTH the global roster and pendingPlayers — simulate
  // that by re-capturing a legacy state with the new player in both places
  // (the same duplication M2H already characterizes).
  const legacyMidTournament = projectApplicationStateToLegacy(canonical);
  const updatedRoster = [...legacyMidTournament.players, { id: 3, name: 'Charlie', elo: 1550 }];
  const legacyWithPending = { ...legacyMidTournament, players: updatedRoster, pendingPlayers: [{ id: 3, name: 'Charlie', elo: 1550 }] };
  canonical = captureApplicationStateFromLegacy(legacyWithPending);
  assert.deepEqual(canonical.tournament.pendingPlayers, [{ id: 3, name: 'Charlie', elo: 1550 }]);

  canonical = advanceTournamentRound(canonical);

  // Charlie is promoted: in tournament.players, joinedRound stamped, and
  // included in Round 2 pairing; pendingPlayers cleared.
  const charlie = canonical.tournament.players.find((p) => p.id === 3);
  assert.ok(charlie);
  assert.equal(charlie.joinedRound, 2);
  assert.deepEqual(canonical.tournament.pendingPlayers, []);
  const round2Ids = canonical.tournament.rounds[2].flatMap((m) => [m.p1.id, m.p2.id]);
  assert.ok(round2Ids.includes(3));

  const legacy = projectApplicationStateToLegacy(canonical);
  assert.ok(legacy.tournament.players.find((p) => p.id === 3));
  assert.deepEqual(legacy.pendingPlayers, []);
  assert.deepEqual(legacy.players, canonical.tournament.roster); // roster unaffected by promotion
});
