import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCHEMA_VERSION,
  createApplicationState,
  createConfig,
  createMatch,
  createPlayer,
  createPreAdvanceSnapshot,
  createTournamentState,
  validateApplicationState,
  validateTournamentState
} from '../src/domain/tournamentModel.js';

// ---------------------------------------------------------------------------
// 1. A minimal current fixed-rack event
// ---------------------------------------------------------------------------

test('a minimal current fixed-rack event is representable', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const config = createConfig();
  const state = createTournamentState({
    started: true,
    tournamentConfig: { title: 'Club Night', ...config },
    config,
    players: [p1, p2],
    rounds: {
      1: [createMatch({ id: 100, p1, p2, tbl: 1, r1: 4, r2: 2, done: true, format: 'fixed_rack' })]
    },
    currentRound: 1
  });

  const result = validateTournamentState(state);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(state.config.format, 'fixed_rack');
  assert.equal(state.tournamentConfig.title, 'Club Night');
  assert.equal(state.rounds[1][0].format, 'fixed_rack');
  assert.equal(state.rounds[1].length, 1);
});

// ---------------------------------------------------------------------------
// 2. A current 14.1 event
// ---------------------------------------------------------------------------

test('a current GBR_14.1 experimental event is representable', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1700 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const config = createConfig({ format: 'straight_pool_14_1', straightPool: { enabled: true } });
  const state = createTournamentState({
    started: true,
    tournamentConfig: { title: '14.1 Club Championship', ...config },
    config,
    players: [p1, p2],
    rounds: {
      1: [createMatch({
        id: 200, p1, p2, tbl: '304', format: 'straight_pool_14_1',
        target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4, done: true
      })]
    },
    currentRound: 1
  });

  const result = validateTournamentState(state);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(state.rounds[1][0].format, 'straight_pool_14_1');
  assert.equal(state.rounds[1][0].target, 30);
  assert.equal(state.rounds[1][0].p1Points, 30);
  // enabling 14.1 merges onto defaults rather than replacing them (see test B).
  assert.equal(state.config.straightPool.startTarget, 40);
});

// ---------------------------------------------------------------------------
// 3. JSON round-trip
// ---------------------------------------------------------------------------

test('JSON.parse(JSON.stringify(state)) preserves canonical tournament meaning', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600, opps: [2], mp: 1 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500, opps: [1] });
  const state = createTournamentState({
    started: true,
    players: [p1, p2],
    rounds: { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' })] },
    currentRound: 1
  });

  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.deepEqual(roundTripped, state);
  assert.equal(roundTripped.rounds[1][0].p1.elo, 1600);
  assert.equal(roundTripped.players[0].opps[0], 2);
});

// ---------------------------------------------------------------------------
// 4. Optional/legacy-compatible fields survive
// ---------------------------------------------------------------------------

test('legacy-optional fields (absent format, absent tbl, absent joinedRound) survive unchanged', () => {
  const p1 = { id: 1, name: 'Alpha', elo: 1600 }; // raw minimal roster-shape player, not createPlayer()
  const p2 = { id: 2, name: 'Bravo', elo: 1500 };
  const state = createTournamentState({
    started: true,
    roster: [p1, p2],
    players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })],
    // No `format` supplied — matches the Manual Pairing Editor's real stored shape exactly.
    rounds: { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true })] }
  });
  assert.equal('format' in state.rounds[1][0], false);
  assert.equal(state.rounds[1][0].tbl, undefined);
  assert.equal(state.players[0].joinedRound, 1); // createPlayer's default, matching startTournament()

  // A hand-built legacy player without joinedRound at all must still validate —
  // the `|| 1` fallback is a consumption-time concern (recalc/before-round),
  // not a construction-time requirement.
  const legacyPlayer = { id: 3, name: 'Charlie', elo: 1500, mp: 0, opps: [] };
  const stateWithLegacyPlayer = createTournamentState({ started: true, players: [legacyPlayer], rounds: {} });
  assert.equal('joinedRound' in stateWithLegacyPlayer.players[0], false);
  assert.deepEqual(validateTournamentState(stateWithLegacyPlayer), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// 5. Player IDs are not coerced
// ---------------------------------------------------------------------------

test('numeric and string player ids remain distinct, never coerced', () => {
  const numericPlayer = createPlayer({ id: 1, name: 'Numeric', elo: 1600 });
  const stringPlayer = createPlayer({ id: '1', name: 'String', elo: 1600 });
  const state = createTournamentState({ started: true, players: [numericPlayer, stringPlayer], rounds: {} });

  assert.equal(typeof state.players[0].id, 'number');
  assert.equal(typeof state.players[1].id, 'string');
  assert.notEqual(state.players[0].id, state.players[1].id); // strict inequality; == would coerce them equal
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// 6. Match snapshots/targets/table/done/cancelled/bye remain representable
// ---------------------------------------------------------------------------

test('match participant snapshots, target, table, and done/cancelled/bye flags are representable', () => {
  const byeMatch = createMatch({
    id: 1, p1: createPlayer({ id: 1, name: 'Solo', elo: 1500 }), p2: { id: 'bye', name: 'FREILOS', elo: 1300 },
    bye: true, tbl: 1, format: 'fixed_rack'
  });
  assert.deepEqual({ r1: byeMatch.r1, r2: byeMatch.r2, done: byeMatch.done, bye: byeMatch.bye }, { r1: 0, r2: 0, done: true, bye: true });

  // The other legacy bye encoding (Manual Pairing Editor: r1 = max_games, r2 = 0,
  // and no `format` key at all) must remain representable too.
  const otherByeEncoding = createMatch({
    id: 2, p1: createPlayer({ id: 1, name: 'Solo', elo: 1500 }), p2: { id: 'bye', name: 'FREILOS', elo: 1300 },
    bye: true, r1: 6, r2: 0
  });
  assert.equal(otherByeEncoding.bye, true);
  assert.equal(otherByeEncoding.r1, 6);
  assert.equal('format' in otherByeEncoding, false);

  const cancelledMatch = createMatch({ id: 3, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, cancelled: true, done: true, r1: 6, r2: 0, format: 'fixed_rack' });
  assert.equal(cancelledMatch.cancelled, true);

  // p1/p2 are full snapshots (not id references) — the pre-match GBR lives on them.
  const snapshotMatch = createMatch({ id: 4, p1: { id: 1, elo: 1713.28 }, p2: { id: 2, elo: 1586.72 }, r1: 5, r2: 1, done: true, tbl: 'A', format: 'fixed_rack' });
  assert.equal(snapshotMatch.p1.elo, 1713.28);
  assert.equal(snapshotMatch.tbl, 'A'); // table assignment may be a string label, not only a number
});

// ---------------------------------------------------------------------------
// 7. removed / joinedRound
// ---------------------------------------------------------------------------

test('removed and joinedRound are representable exactly as current legacy semantics require', () => {
  const withdrawn = createPlayer({ id: 1, name: 'Withdrawn', elo: 1600, removed: true });
  const lateJoiner = createPlayer({ id: 2, name: 'Late', elo: 1500, joinedRound: 3 });
  const state = createTournamentState({ started: true, players: [withdrawn, lateJoiner], rounds: {} });

  assert.equal(state.players[0].removed, true);
  assert.equal(state.players[1].joinedRound, 3);
  // `removed` stays a boolean flag — this module does not introduce Player.status.
  assert.equal('status' in state.players[0], false);
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// 8. No functions / non-serializable values
// ---------------------------------------------------------------------------

test('the model contains no functions, class instances, Map/Set, or Date values', () => {
  const state = createTournamentState({
    started: true,
    players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
    rounds: { 1: [createMatch({ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, done: true, format: 'fixed_rack' })] }
  });

  const walk = (value) => {
    if (value === null || typeof value !== 'object') {
      assert.notEqual(typeof value, 'function');
      return;
    }
    assert.equal(value instanceof Map, false);
    assert.equal(value instanceof Set, false);
    assert.equal(value instanceof Date, false);
    for (const v of Array.isArray(value) ? value : Object.values(value)) walk(v);
  };
  walk(state);

  // JSON.stringify silently drops functions/undefined; confirm nothing round-trips away.
  assert.equal(JSON.stringify(state), JSON.stringify(JSON.parse(JSON.stringify(state))));
});

// ---------------------------------------------------------------------------
// 9 & 10. Validation acceptance / rejection
// ---------------------------------------------------------------------------

test('validation accepts representative current-state examples, including quirky-but-legal legacy shapes', () => {
  // Mixed id types across players, a bye with the "other" r1/r2 encoding and
  // no format, a 14.1 match missing its target (legacy fallback resolves this
  // at replay time, not construction time), and a match with no table
  // assignment yet.
  const state = createTournamentState({
    started: true,
    players: [createPlayer({ id: 1, name: 'A', elo: 1600 }), createPlayer({ id: '2', name: 'B', elo: 1500 })],
    rounds: {
      1: [
        createMatch({ id: 'bye-1', p1: { id: 1, elo: 1600 }, p2: { id: 'bye', name: 'FREILOS', elo: 1300 }, bye: true, r1: 6, r2: 0 }),
        createMatch({ id: 2, p1: { id: '2', elo: 1500 }, p2: { id: 3, elo: 1500 }, format: 'straight_pool_14_1', done: true })
      ]
    }
  });
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

test('validation rejects only clearly malformed structural input', () => {
  const base = createTournamentState({
    started: true,
    players: [createPlayer({ id: 1, name: 'A', elo: 1600 })],
    rounds: { 1: [createMatch({ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, done: true, format: 'fixed_rack' })] }
  });

  assert.equal(validateTournamentState(null).valid, false);
  assert.equal(validateTournamentState([]).valid, false);
  assert.equal(validateTournamentState({ ...base, players: 'not-an-array' }).valid, false);
  assert.equal(validateTournamentState({ ...base, rounds: [] }).valid, false); // rounds must stay object-keyed, not an array
  assert.equal(validateTournamentState({ ...base, config: null }).valid, false);
  assert.equal(validateTournamentState({ ...base, tournamentConfig: null }).valid, false);
  assert.equal(validateTournamentState({ ...base, roster: 'nope' }).valid, false);
  assert.equal(validateTournamentState({ ...base, pendingPlayers: {} }).valid, false);
  assert.equal(validateTournamentState({ ...base, currentRound: '1' }).valid, false);
  assert.equal(validateTournamentState({ ...base, totalRounds: null }).valid, false);

  const missingPlayerId = { ...base, players: [{ name: 'No id' }] };
  assert.equal(validateTournamentState(missingPlayerId).valid, false);

  const badRoundShape = { ...base, rounds: { 1: 'not-an-array' } };
  assert.equal(validateTournamentState(badRoundShape).valid, false);

  const matchMissingP2Id = { ...base, rounds: { 1: [{ id: 1, p1: { id: 1 }, p2: {}, done: true, cancelled: false, bye: false }] } };
  assert.equal(validateTournamentState(matchMissingP2Id).valid, false);

  const doneNotBoolean = { ...base, rounds: { 1: [{ id: 1, p1: { id: 1 }, p2: { id: 2 }, done: 'yes', cancelled: false, bye: false }] } };
  assert.equal(validateTournamentState(doneNotBoolean).valid, false);

  // A missing schemaVersion is NOT malformed — raw legacy autosave predates it.
  const { schemaVersion, ...withoutSchemaVersion } = base;
  assert.equal(validateTournamentState(withoutSchemaVersion).valid, true);
});

// ---------------------------------------------------------------------------
// Misc: schemaVersion
// ---------------------------------------------------------------------------

test('createTournamentState stamps the current schemaVersion', () => {
  const state = createTournamentState({ started: true });
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(typeof SCHEMA_VERSION, 'number');
});

// ---------------------------------------------------------------------------
// A. config / tournamentConfig divergence
// ---------------------------------------------------------------------------

test('A: config and tournamentConfig can diverge, and both survive independently through JSON', () => {
  const setupConfig = createConfig({ d: 330, k_m: 30 });
  // Mirrors the "Tournament Settings" modal editing `config` mid-tournament
  // without touching `tournamentConfig` — a real current divergence.
  const liveConfig = createConfig({ d: 350, k_m: 25 });
  const state = createTournamentState({
    started: true,
    tournamentConfig: { title: 'Original Title', ...setupConfig },
    config: liveConfig
  });

  assert.equal(state.config.d, 350);
  assert.equal(state.tournamentConfig.d, 330);
  assert.notEqual(state.config.d, state.tournamentConfig.d);

  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.equal(roundTripped.config.d, 350);
  assert.equal(roundTripped.tournamentConfig.d, 330);
  assert.equal(roundTripped.tournamentConfig.title, 'Original Title');
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// B. Partial straightPool override merges with defaults
// ---------------------------------------------------------------------------

test('B: a partial straightPool override merges onto STRAIGHT_POOL_DEFAULTS rather than replacing it', () => {
  const config = createConfig({ straightPool: { k_14_1: 25, startTarget: 30 } });
  assert.equal(config.straightPool.k_14_1, 25);
  assert.equal(config.straightPool.startTarget, 30);
  // Every unspecified default must survive exactly.
  assert.equal(config.straightPool.useTargetScaledK, true);
  assert.equal(config.straightPool.targetReference, 40);
  assert.equal(config.straightPool.marginWeight, 0.60);
  assert.equal(config.straightPool.bpiWeight, 0.30);
  assert.equal(config.straightPool.highRunWeight, 0.10);
  assert.deepEqual(config.straightPool.tierTargets, [50, 40, 30]);
  assert.equal(config.straightPool.tieringStartsRound, 2);
  assert.equal(config.straightPool.standingsOrder, 'mp_perf_npd');

  // No straightPool override at all still returns the full defaults, unchanged.
  assert.deepEqual(createConfig().straightPool, createConfig({ straightPool: undefined }).straightPool);
});

// ---------------------------------------------------------------------------
// C. Production-style manual (Manual Pairing Editor) match
// ---------------------------------------------------------------------------

test('C: a production-style Manual Pairing Editor match (no format field) validates', () => {
  // Mirrors performApplyManualPairings()'s actual returned object shape exactly:
  // { id, p1, p2, r1, r2, done, cancelled, bye, tbl } — no `format` key.
  const manualMatch = {
    id: 1755000000000,
    p1: { id: 1, name: 'Alpha', elo: 1600 },
    p2: { id: 2, name: 'Bravo', elo: 1500 },
    r1: 0,
    r2: 0,
    done: false,
    cancelled: false,
    bye: false,
    tbl: 1
  };
  assert.equal('format' in manualMatch, false);
  const state = createTournamentState({
    started: true,
    players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })],
    rounds: { 1: [manualMatch] }
  });
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// D. Production-style automatic (createPairings) match
// ---------------------------------------------------------------------------

test('D: a production-style createPairings() match matches the actual current shape', () => {
  // Mirrors createPairings()'s base match object construction: numeric
  // Date.now()+idx id, explicit format, tbl falling back to a 1-based index.
  const idx = 0;
  const startTableIndex = 0;
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const automaticMatch = createMatch({
    id: Date.now() + idx,
    p1, p2,
    r1: 0, r2: 0,
    done: false,
    cancelled: false,
    bye: false,
    tbl: startTableIndex + idx + 1, // tableNumbers[...] || fallback
    format: 'fixed_rack'
  });
  assert.equal(typeof automaticMatch.id, 'number');
  assert.equal(automaticMatch.format, 'fixed_rack');
  assert.equal(automaticMatch.tbl, 1);
  const state = createTournamentState({ started: true, players: [p1, p2], rounds: { 1: [automaticMatch] } });
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// E. Configured/pre-start tournament state (before Round 1 exists)
// ---------------------------------------------------------------------------

test('E: a configured but not-yet-started tournament (before Round 1) is representable', () => {
  const config = createConfig();
  const state = createTournamentState({
    started: false, // configured but Round 1 has not started
    tournamentConfig: { title: 'Friday Night Championship', ...config },
    config,
    players: [], // startTournament() has not run yet — tournament.players is still empty
    roster: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })],
    rounds: {}, // no Round 1 pairings generated yet
    currentRound: 0
  });
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
  assert.equal(Object.keys(state.rounds).length, 0);
  assert.equal(state.currentRound, 0);
  assert.equal(state.roster.length, 2);
});

// ---------------------------------------------------------------------------
// F. Pending/promoted player transient shape
// ---------------------------------------------------------------------------

test('F: a mid-nextRound() promoted player (missing rp/14.1 aggregates) validates without forcing steady-state fields', () => {
  // Mirrors nextRound()'s actual newTournamentPlayers.push({...}) shape exactly:
  // no rp, no pointsFor/pointsAgainst/inningsTotal/npd/hs/hgd yet (recalc()
  // fills those in on its next pass).
  const promotedPlayer = {
    id: 3, name: 'Charlie', elo: 1500,
    mp: 0, perf: 0, perfCount: 0, games: 0,
    racksWon: 0, racksLost: 0, opps: [],
    removed: false, joinedRound: 2, avgPerf: 0
  };
  assert.equal('rp' in promotedPlayer, false);
  assert.equal('npd' in promotedPlayer, false);
  const state = createTournamentState({ started: true, players: [promotedPlayer], rounds: {} });
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// G. Operational undo state (PreAdvanceSnapshot / ApplicationState)
// ---------------------------------------------------------------------------

test('G: a production-shaped PreAdvanceSnapshot (allRounds, not rounds) round-trips through JSON with exactly what confirmUndoAdvance() needs', () => {
  // Mirrors nextRound()'s actual call precisely:
  //   setPreAdvanceSnapshot({
  //     tournament: JSON.parse(JSON.stringify(tournament)),
  //     allRounds: JSON.parse(JSON.stringify(allRounds)),
  //     currentRound, viewingRound,
  //     pendingPlayers: JSON.parse(JSON.stringify(pendingPlayers))
  //   });
  // `tournament` here is the legacy `{players, totalRounds}` component state
  // shape at snapshot time — not necessarily a full canonical Tournament
  // (see the "OPERATIONAL / SESSION STATE" notes) — so it is built as a raw
  // literal, not via createTournamentState().
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const legacyTournament = { players: [p1, p2], totalRounds: 4 };
  const legacyAllRounds = { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' })] };

  const snapshot = createPreAdvanceSnapshot({
    tournament: legacyTournament,
    allRounds: legacyAllRounds,
    currentRound: 1,
    viewingRound: 1,
    pendingPlayers: [{ id: 4, name: 'Pending', elo: 1550 }]
  });
  const appState = createApplicationState({ preAdvanceSnapshot: snapshot });

  // confirmUndoAdvance() reads exactly these five fields off preAdvanceSnapshot.
  assert.ok('tournament' in snapshot);
  assert.ok('allRounds' in snapshot);
  assert.ok('currentRound' in snapshot);
  assert.ok('viewingRound' in snapshot);
  assert.ok('pendingPlayers' in snapshot);
  assert.equal('rounds' in snapshot, false); // the field is allRounds, never rounds

  const roundTripped = JSON.parse(JSON.stringify(appState));
  assert.deepEqual(roundTripped, appState);
  assert.equal(roundTripped.preAdvanceSnapshot.currentRound, 1);
  assert.equal(roundTripped.preAdvanceSnapshot.viewingRound, 1);
  assert.equal(roundTripped.preAdvanceSnapshot.pendingPlayers[0].name, 'Pending');
  assert.equal(roundTripped.preAdvanceSnapshot.allRounds[1][0].r1, 4);
  assert.equal(roundTripped.preAdvanceSnapshot.tournament.totalRounds, 4);
  assert.equal(roundTripped.preAdvanceSnapshot.tournament.players.length, 2);
  assert.deepEqual(validateApplicationState(appState), { valid: true, errors: [] });

  // An empty/never-advanced session (no undo available yet) is equally valid.
  assert.deepEqual(validateApplicationState(createApplicationState()), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// H. started — explicit lifecycle fact (M2K-A)
// ---------------------------------------------------------------------------
//
// started is NOT inferred from player/round counts, currentRound, match
// existence, or pendingPlayers — it is only ever what the caller explicitly
// states. These tests cover the contract at the construction/validation
// layer only; the started: false -> true transition (starting Round 1) is
// out of scope here.

test('H1: a canonical Tournament with started: false validates', () => {
  const state = createTournamentState({
    started: false,
    tournamentConfig: { title: 'Not started yet' },
    players: [],
    roster: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
    rounds: {},
    currentRound: 0
  });
  assert.equal(state.started, false);
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

test('H2: a canonical Tournament with started: true validates', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const state = createTournamentState({
    started: true,
    players: [p1, p2],
    rounds: { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, format: 'fixed_rack' })] },
    currentRound: 1
  });
  assert.equal(state.started, true);
  assert.deepEqual(validateTournamentState(state), { valid: true, errors: [] });
});

test('H3: a non-null canonical Tournament missing started is rejected', () => {
  const { started, ...withoutStarted } = createTournamentState({ started: true, players: [], rounds: {} });
  assert.equal('started' in withoutStarted, false);
  const result = validateTournamentState(withoutStarted);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('started')));
});

test('H4: a non-boolean started is rejected', () => {
  const base = createTournamentState({ started: true, players: [], rounds: {} });
  for (const badValue of ['true', 1, 0, null, undefined, {}]) {
    const result = validateTournamentState({ ...base, started: badValue });
    assert.equal(result.valid, false, `expected started: ${JSON.stringify(badValue)} to be rejected`);
    assert.ok(result.errors.some((e) => e.includes('started')));
  }
});

test('H5: JSON round-trip preserves started: false exactly', () => {
  const state = createTournamentState({ started: false, players: [], rounds: {} });
  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.equal(roundTripped.started, false);
  assert.deepEqual(roundTripped, state);
});

test('H6: JSON round-trip preserves started: true exactly', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const state = createTournamentState({ started: true, players: [p1], rounds: { 1: [] }, currentRound: 1 });
  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.equal(roundTripped.started, true);
  assert.deepEqual(roundTripped, state);
});
