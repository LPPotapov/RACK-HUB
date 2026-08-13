import assert from 'node:assert/strict';
import test from 'node:test';
import { createTournamentStore } from '../src/application/tournamentStore.js';
import {
  createApplicationState,
  createConfig,
  createMatch,
  createPlayer,
  createPreAdvanceSnapshot,
  createTournamentState
} from '../src/domain/tournamentModel.js';

const closeTo = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

// ---------------------------------------------------------------------------
// 1-4. Store creation across the four approved lifecycle modes
// ---------------------------------------------------------------------------

test('1: creates a store with EMPTY ApplicationState', () => {
  const store = createTournamentStore(createApplicationState());
  assert.deepEqual(store.getState(), { tournament: null, preAdvanceSnapshot: null });
});

test('2: creates a store with CONFIGURED_PRE_START state', () => {
  const config = createConfig();
  const applicationState = createApplicationState({
    tournament: createTournamentState({
      config,
      tournamentConfig: { title: 'Friday Night Championship', ...config },
      players: [], // no accumulating participants yet — see M2H
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: {},
      currentRound: 0
    })
  });
  const store = createTournamentStore(applicationState);
  const state = store.getState();
  assert.notEqual(state.tournament, null);
  assert.deepEqual(state.tournament.players, []);
  assert.equal(state.tournament.roster.length, 2);
  assert.equal(state.preAdvanceSnapshot, null);
});

test('3: creates a store with RUNNING state', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1613.28 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1586.72 });
  const applicationState = createApplicationState({
    tournament: createTournamentState({
      players: [p1, p2],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }],
      rounds: { 1: [createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, format: 'fixed_rack' })] },
      currentRound: 1
    })
  });
  const store = createTournamentStore(applicationState);
  const state = store.getState();
  assert.equal(state.tournament.players.length, 2);
  assert.equal(state.tournament.currentRound, 1);
});

test('4: creates a store with RUNNING state plus a preAdvanceSnapshot', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const applicationState = createApplicationState({
    tournament: createTournamentState({ players: [p1], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 1 }),
    preAdvanceSnapshot: createPreAdvanceSnapshot({
      tournament: { players: [p1], totalRounds: 4 },
      allRounds: { 1: [] },
      currentRound: 1,
      viewingRound: 1,
      pendingPlayers: []
    })
  });
  const store = createTournamentStore(applicationState);
  const state = store.getState();
  assert.notEqual(state.preAdvanceSnapshot, null);
  assert.equal('allRounds' in state.preAdvanceSnapshot, true);
});

// ---------------------------------------------------------------------------
// 5. Invalid initial state is rejected
// ---------------------------------------------------------------------------

test('5: invalid initial state is rejected', () => {
  assert.throws(() => createTournamentStore({ tournament: 'not-an-object' }), /invalid ApplicationState/);
  assert.throws(() => createTournamentStore(null), /invalid ApplicationState/);
});

// ---------------------------------------------------------------------------
// 6-7. getState isolation / initial-input isolation
// ---------------------------------------------------------------------------

test('6: getState returns an isolated copy on every call', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({ players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {} })
  }));
  const first = store.getState();
  first.tournament.players[0].elo = 9999;
  first.tournament.roster.push({ id: 99, name: 'Injected', elo: 1 });

  const second = store.getState();
  assert.equal(second.tournament.players[0].elo, 1600);
  assert.equal(second.tournament.roster.length, 1);
  assert.notEqual(first, second); // different object identities
});

test('7: mutating the initial input after store creation does not mutate the store', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }];
  const applicationState = createApplicationState({
    tournament: createTournamentState({ players: [p1], roster, rounds: { 1: [] }, currentRound: 1 })
  });

  const store = createTournamentStore(applicationState);

  p1.elo = 9999;
  roster.push({ id: 2, name: 'Injected', elo: 1 });
  applicationState.tournament.currentRound = 999;

  const state = store.getState();
  assert.equal(state.tournament.players[0].elo, 1600);
  assert.equal(state.tournament.roster.length, 1);
  assert.equal(state.tournament.currentRound, 1);
});

// ---------------------------------------------------------------------------
// 8-10. replaceState behavior
// ---------------------------------------------------------------------------

test('8: replaceState accepts a valid state', () => {
  const store = createTournamentStore(createApplicationState());
  const next = createApplicationState({
    tournament: createTournamentState({ players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0 })
  });
  store.replaceState(next);
  assert.notEqual(store.getState().tournament, null);
});

test('9: replaceState rejects invalid state and leaves the previous valid state unchanged', () => {
  const valid = createApplicationState({
    tournament: createTournamentState({ players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0 })
  });
  const store = createTournamentStore(valid);

  assert.throws(() => store.replaceState({ tournament: { config: null } }), /invalid ApplicationState/);

  const state = store.getState();
  assert.equal(state.tournament.players.length, 1);
  assert.equal(state.tournament.players[0].name, 'Alpha');
});

test('10: mutating the replacement input after replaceState() does not mutate the store', () => {
  const store = createTournamentStore(createApplicationState());
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const next = createApplicationState({
    tournament: createTournamentState({ players: [p1], roster: [{ id: 1, name: 'Alpha', elo: 1600 }], rounds: {}, currentRound: 0 })
  });
  store.replaceState(next);

  p1.elo = 42;
  next.tournament.currentRound = 999;

  const state = store.getState();
  assert.equal(state.tournament.players[0].elo, 1600);
  assert.equal(state.tournament.currentRound, 0);
});

// ---------------------------------------------------------------------------
// updateState(updater)
// ---------------------------------------------------------------------------

test('updateState: a successful update commits the returned state, and updater receives the current state', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  let receivedByUpdater = null;
  store.updateState((current) => {
    receivedByUpdater = current;
    return {
      ...current,
      tournament: { ...current.tournament, currentRound: 2 }
    };
  });

  // updater received the store's actual current state.
  assert.equal(receivedByUpdater.tournament.currentRound, 1);
  assert.equal(receivedByUpdater.tournament.players[0].name, 'Alpha');

  // The returned state became the new store state.
  const state = store.getState();
  assert.equal(state.tournament.currentRound, 2);
  // Unrelated state is preserved (updater only changed currentRound).
  assert.equal(state.tournament.players[0].name, 'Alpha');
  assert.equal(state.tournament.roster[0].name, 'Alpha');
});

test('updateState: a successful update also works starting from a CONFIGURED_PRE_START state', () => {
  const config = createConfig();
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      config,
      tournamentConfig: { title: 'Not started yet', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  }));

  store.updateState((current) => ({
    ...current,
    tournament: { ...current.tournament, pendingPlayers: [{ id: 2, name: 'Bravo', elo: 1500 }] }
  }));

  const state = store.getState();
  assert.deepEqual(state.tournament.pendingPlayers, [{ id: 2, name: 'Bravo', elo: 1500 }]);
  assert.equal(state.tournament.tournamentConfig.title, 'Not started yet'); // unrelated state preserved
});

test('updateState: mutating the state argument inside updater does not affect the store until (unless) it commits', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  let sawMidMutationEffectOnStore = false;
  store.updateState((current) => {
    current.tournament.currentRound = 999; // mutate the argument in place
    // The store must not reflect this mutation while the updater is still running.
    if (store.getState().tournament.currentRound === 999) sawMidMutationEffectOnStore = true;
    return current; // now commit the (mutated) object
  });

  assert.equal(sawMidMutationEffectOnStore, false);
  // The mutated value legitimately became the new state once returned/committed.
  assert.equal(store.getState().tournament.currentRound, 999);
});

test('updateState: an updater returning undefined throws and leaves the previous valid state unchanged', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  assert.throws(() => store.updateState(() => undefined), /invalid ApplicationState/);

  const state = store.getState();
  assert.equal(state.tournament.currentRound, 1);
  assert.equal(state.tournament.players[0].name, 'Alpha');
});

test('updateState: an updater returning a structurally invalid ApplicationState throws and leaves the previous valid state unchanged', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  assert.throws(() => store.updateState((current) => ({ ...current, tournament: { ...current.tournament, config: null } })), /invalid ApplicationState/);

  const state = store.getState();
  assert.equal(state.tournament.currentRound, 1);
  assert.notEqual(state.tournament.config, null);
});

test('updateState: an updater that throws propagates the error and leaves store state unchanged', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  assert.throws(() => store.updateState(() => { throw new Error('updater blew up'); }), /updater blew up/);

  const state = store.getState();
  assert.equal(state.tournament.currentRound, 1);
  assert.equal(state.tournament.players[0].name, 'Alpha');
});

test('updateState: mutating the object returned by updater after it commits does not mutate the store', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 1
    })
  }));

  let committedObject = null;
  store.updateState((current) => {
    committedObject = { ...current, tournament: { ...current.tournament, currentRound: 5 } };
    return committedObject;
  });
  assert.equal(store.getState().tournament.currentRound, 5);

  // Mutate the exact object that was returned/committed, after the fact.
  committedObject.tournament.currentRound = 12345;
  committedObject.tournament.players[0].elo = 1;

  const state = store.getState();
  assert.equal(state.tournament.currentRound, 5);
  assert.equal(state.tournament.players[0].elo, 1600);
});

// ---------------------------------------------------------------------------
// 11-13. getStandingsBeforeRound query
// ---------------------------------------------------------------------------

test('11: getStandingsBeforeRound() delegates correctly for fixed-rack history', () => {
  // Same 4-player fixed-rack fixture/values as tests/before-round-standings.test.js's
  // "before round 3" case: rounds 1-2 fully replayed.
  const players = [
    createPlayer({ id: 1, name: 'Alpha', elo: 1700 }),
    createPlayer({ id: 2, name: 'Bravo', elo: 1600 }),
    createPlayer({ id: 3, name: 'Charlie', elo: 1500 }),
    createPlayer({ id: 4, name: 'Delta', elo: 1400 })
  ];
  const roster = players.map(({ id, name, elo }) => ({ id, name, elo }));
  const rounds = {
    1: [
      createMatch({ id: 'r1m1', p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1600 }, r1: 5, r2: 1, done: true, format: 'fixed_rack' }),
      createMatch({ id: 'r1m2', p1: { id: 3, elo: 1500 }, p2: { id: 4, elo: 1400 }, r1: 3, r2: 3, done: true, format: 'fixed_rack' })
    ],
    2: [
      createMatch({ id: 'r2m1', p1: { id: 2, elo: 1586.7178037424442 }, p2: { id: 3, elo: 1491.6155295908893 }, r1: 4, r2: 2, done: true, format: 'fixed_rack' }),
      createMatch({ id: 'r2m2', p1: { id: 1, elo: 1713.2821962575558 }, p2: { id: 4, elo: 1408.3844704091107 }, r1: 2, r2: 4, done: true, format: 'fixed_rack' })
    ]
  };
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({ players, roster, rounds, currentRound: 2 })
  }));

  const standings = store.getStandingsBeforeRound(3);
  closeTo(standings[1].elo, 1675.2718085420506);
  closeTo(standings[2].elo, 1597.0479416625346);
  closeTo(standings[3].elo, 1481.2853916707988);
  closeTo(standings[4].elo, 1446.394858124616);
  assert.deepEqual([standings[1].mp, standings[2].mp, standings[3].mp, standings[4].mp], [1, 1, 0.5, 1.5]);
});

test('12: getStandingsBeforeRound() delegates correctly for GBR_14.1 experimental history', () => {
  const config = createConfig({ format: 'straight_pool_14_1' });
  const players = [createPlayer({ id: 1, name: 'Alpha', elo: 1700 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })];
  const roster = [{ id: 1, name: 'Alpha', elo: 1700 }, { id: 2, name: 'Bravo', elo: 1500 }];
  const rounds = {
    1: [createMatch({
      id: 1, p1: { id: 1, elo: 1700 }, p2: { id: 2, elo: 1500 }, done: true, format: 'straight_pool_14_1',
      target: 30, p1Points: 30, p2Points: 16, innings: 9, p1HighRun: 9, p2HighRun: 4
    })]
  };
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({ config, players, roster, rounds, currentRound: 1 })
  }));

  const standings = store.getStandingsBeforeRound(2);
  closeTo(standings[1].elo, 1704.2829721547807);
  closeTo(standings[2].elo, 1495.7170278452193);
  assert.equal(standings[1].mp, 1);
  assert.equal(standings[2].mp, 0);
});

test('13: getStandingsBeforeRound() does not mutate the store\'s state', () => {
  const players = [createPlayer({ id: 1, name: 'Alpha', elo: 1600 }), createPlayer({ id: 2, name: 'Bravo', elo: 1500 })];
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  const rounds = { 1: [createMatch({ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, format: 'fixed_rack' })] };
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({ players, roster, rounds, currentRound: 1 })
  }));

  const before = store.getState();
  store.getStandingsBeforeRound(2);
  const after = store.getState();
  assert.deepEqual(before, after);
});

test('getStandingsBeforeRound() throws a clear error for an EMPTY application', () => {
  const store = createTournamentStore(createApplicationState());
  assert.throws(() => store.getStandingsBeforeRound(1), /no tournament/);
});

test('getStandingsBeforeRound() returns an empty standings object for a CONFIGURED_PRE_START tournament', () => {
  const config = createConfig();
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      config,
      tournamentConfig: { title: 'Not started yet', ...config },
      players: [],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  }));
  assert.deepEqual(store.getStandingsBeforeRound(1), {});
});

// ---------------------------------------------------------------------------
// 14-15. config/tournamentConfig and roster/players independence survive ownership
// ---------------------------------------------------------------------------

test('14: config/tournamentConfig divergence survives store ownership', () => {
  const setupConfig = createConfig({ d: 330 });
  const liveConfig = createConfig({ d: 350 });
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      config: liveConfig,
      tournamentConfig: { title: 'Club Night', ...setupConfig },
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: {},
      currentRound: 0
    })
  }));
  const state = store.getState();
  assert.equal(state.tournament.config.d, 350);
  assert.equal(state.tournament.tournamentConfig.d, 330);
});

test('15: roster/tournament.players distinction survives store ownership', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo (pending)', elo: 1500 }],
      pendingPlayers: [{ id: 2, name: 'Bravo (pending)', elo: 1500 }],
      rounds: {},
      currentRound: 1
    })
  }));
  const state = store.getState();
  assert.equal(state.tournament.players.length, 1);
  assert.equal(state.tournament.roster.length, 2);
});

// ---------------------------------------------------------------------------
// Serialization readiness
// ---------------------------------------------------------------------------

test('the store\'s state is always plain JSON-serializable', () => {
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [createPlayer({ id: 1, name: 'Alpha', elo: 1600 })],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: { 1: [createMatch({ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, format: 'fixed_rack' })] },
      currentRound: 1
    })
  }));

  const serialized = JSON.stringify(store.getState());
  assert.equal(typeof serialized, 'string');
  assert.deepEqual(JSON.parse(serialized), store.getState());

  const walk = (value) => {
    if (value === null || typeof value !== 'object') { assert.notEqual(typeof value, 'function'); return; }
    for (const v of Array.isArray(value) ? value : Object.values(value)) walk(v);
  };
  walk(store.getState());
});

// ---------------------------------------------------------------------------
// store.assignMatchTable() — M2J follow-up: COMMAND -> STORE -> ATOMIC
// VALIDATED COMMIT. The characterized legacy table semantics themselves
// (number/string, blank allowed, overwrite, done/cancelled still changeable,
// no uniqueness enforcement) are already fully covered by
// tests/tournament-commands.test.js against the pure command; these tests
// focus on what the store adds: exposing it as a method, committing through
// updateState(), and leaving everything else untouched.
// ---------------------------------------------------------------------------

const twoMatchRunningState = () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const p3 = createPlayer({ id: 3, name: 'Charlie', elo: 1550 });
  const p4 = createPlayer({ id: 4, name: 'Delta', elo: 1450 });
  const config = createConfig();
  return createApplicationState({
    tournament: createTournamentState({
      config,
      tournamentConfig: { title: 'Club Night', ...config },
      players: [p1, p2, p3, p4],
      roster: [p1, p2, p3, p4].map(({ id, name, elo }) => ({ id, name, elo })),
      pendingPlayers: [{ id: 5, name: 'Echo (pending)', elo: 1400 }],
      rounds: {
        1: [
          createMatch({ id: 1, p1, p2, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' }),
          createMatch({ id: 2, p1: p3, p2: p4, r1: 0, r2: 0, done: false, tbl: 2, format: 'fixed_rack' })
        ]
      },
      currentRound: 1
    })
  });
};

test('16: store.assignMatchTable() commits a successful table assignment', () => {
  const store = createTournamentStore(twoMatchRunningState());
  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 5 });
  assert.equal(store.getState().tournament.rounds[1][0].tbl, 5);
});

test('17: store.assignMatchTable() overwrites an existing table assignment', () => {
  const store = createTournamentStore(twoMatchRunningState());
  assert.equal(store.getState().tournament.rounds[1][0].tbl, 1);
  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 9 });
  assert.equal(store.getState().tournament.rounds[1][0].tbl, 9);
});

test('18: store.assignMatchTable() accepts a blank \'\' table value unchanged', () => {
  const store = createTournamentStore(twoMatchRunningState());
  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: '' });
  assert.equal(store.getState().tournament.rounds[1][0].tbl, '');
});

test('19: store.assignMatchTable() preserves numeric and string table value types', () => {
  const numberStore = createTournamentStore(twoMatchRunningState());
  numberStore.assignMatchTable({ roundNumber: 1, matchId: 1, table: 7 });
  assert.equal(typeof numberStore.getState().tournament.rounds[1][0].tbl, 'number');

  const stringStore = createTournamentStore(twoMatchRunningState());
  stringStore.assignMatchTable({ roundNumber: 1, matchId: 1, table: 'Court 7' });
  assert.equal(typeof stringStore.getState().tournament.rounds[1][0].tbl, 'string');
});

test('20: a missing round throws and leaves store state unchanged', () => {
  const store = createTournamentStore(twoMatchRunningState());
  const before = store.getState();
  assert.throws(() => store.assignMatchTable({ roundNumber: 99, matchId: 1, table: 5 }), /round 99 does not exist/);
  assert.deepEqual(store.getState(), before);
});

test('21: a missing match throws and leaves store state unchanged', () => {
  const store = createTournamentStore(twoMatchRunningState());
  const before = store.getState();
  assert.throws(() => store.assignMatchTable({ roundNumber: 1, matchId: 'does-not-exist', table: 5 }), /does not exist in round/);
  assert.deepEqual(store.getState(), before);
});

test('22: an EMPTY application throws and leaves store state unchanged', () => {
  const store = createTournamentStore(createApplicationState());
  assert.throws(() => store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 5 }), /no tournament/);
  assert.deepEqual(store.getState(), { tournament: null, preAdvanceSnapshot: null });
});

test('23: only the requested match changes; players/roster/pendingPlayers/config/tournamentConfig are untouched', () => {
  const store = createTournamentStore(twoMatchRunningState());
  const before = store.getState();

  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 42 });
  const after = store.getState();

  assert.equal(after.tournament.rounds[1][1].tbl, 2); // other match untouched
  assert.deepEqual(after.tournament.players, before.tournament.players); // no recalculation
  assert.deepEqual(after.tournament.roster, before.tournament.roster);
  assert.deepEqual(after.tournament.pendingPlayers, before.tournament.pendingPlayers);
  assert.deepEqual(after.tournament.config, before.tournament.config);
  assert.deepEqual(after.tournament.tournamentConfig, before.tournament.tournamentConfig);
});

test('24: a preAdvanceSnapshot present on the store is not modified by assignMatchTable()', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [p1],
      roster: [{ id: 1, name: 'Alpha', elo: 1600 }],
      rounds: { 1: [createMatch({ id: 1, p1: { id: 1, elo: 1600 }, p2: { id: 2, elo: 1500 }, r1: 4, r2: 2, done: true, tbl: 1 })] },
      currentRound: 1
    }),
    preAdvanceSnapshot: createPreAdvanceSnapshot({
      tournament: { players: [p1], totalRounds: 4 },
      allRounds: { 1: [] },
      currentRound: 1,
      viewingRound: 1,
      pendingPlayers: []
    })
  }));
  const before = store.getState().preAdvanceSnapshot;

  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 'New Table' });

  assert.deepEqual(store.getState().preAdvanceSnapshot, before);
});

test('25: getState() isolation still holds after a table assignment', () => {
  const store = createTournamentStore(twoMatchRunningState());
  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 5 });

  const first = store.getState();
  first.tournament.rounds[1][0].tbl = 'mutated';
  const second = store.getState();

  assert.equal(second.tournament.rounds[1][0].tbl, 5);
});

test('26: store.assignMatchTable() works regardless of match format (14.1, and no format field at all)', () => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const p3 = createPlayer({ id: 3, name: 'Charlie', elo: 1550 });
  const store = createTournamentStore(createApplicationState({
    tournament: createTournamentState({
      players: [p1, p2, p3],
      roster: [p1, p2, p3].map(({ id, name, elo }) => ({ id, name, elo })),
      rounds: {
        1: [
          createMatch({ id: 1, p1, p2, done: true, tbl: 1, format: 'straight_pool_14_1', target: 30, p1Points: 30, p2Points: 16, innings: 9 }),
          { id: 2, p1: { id: 1, elo: 1600 }, p2: { id: 3, elo: 1550 }, r1: 0, r2: 0, done: false, cancelled: false, bye: false, tbl: 2 } // no `format` at all
        ]
      },
      currentRound: 1
    })
  }));

  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 'A' });
  store.assignMatchTable({ roundNumber: 1, matchId: 2, table: 'B' });

  const state = store.getState();
  assert.equal(state.tournament.rounds[1][0].tbl, 'A');
  assert.equal(state.tournament.rounds[1][1].tbl, 'B');
  assert.equal('format' in state.tournament.rounds[1][1], false); // still absent, not invented
});

test('27: a numeric roundNumber correctly locates a round whose canonical keys are (post-clone) strings', () => {
  const store = createTournamentStore(twoMatchRunningState());
  // The store clones through JSON on every read/write, so internally
  // `tournament.rounds` keys are always strings (`Object.keys` on any plain
  // object is always strings) — confirm a numeric roundNumber still resolves
  // correctly via JS's implicit property-key coercion.
  assert.deepEqual(Object.keys(store.getState().tournament.rounds), ['1']);
  store.assignMatchTable({ roundNumber: 1, matchId: 1, table: 'Resolved' });
  assert.equal(store.getState().tournament.rounds[1][0].tbl, 'Resolved');
});
