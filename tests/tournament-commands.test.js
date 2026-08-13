import assert from 'node:assert/strict';
import test from 'node:test';
import { assignMatchTable } from '../src/application/tournamentCommands.js';
import { createTournamentStore } from '../src/application/tournamentStore.js';
import {
  createApplicationState,
  createMatch,
  createPlayer,
  createTournamentState,
  validateApplicationState
} from '../src/domain/tournamentModel.js';

const twoMatchState = (overrides = {}) => {
  const p1 = createPlayer({ id: 1, name: 'Alpha', elo: 1600 });
  const p2 = createPlayer({ id: 2, name: 'Bravo', elo: 1500 });
  const p3 = createPlayer({ id: 3, name: 'Charlie', elo: 1550 });
  const p4 = createPlayer({ id: 4, name: 'Delta', elo: 1450 });
  return createApplicationState({
    tournament: createTournamentState({
      players: [p1, p2, p3, p4],
      roster: [p1, p2, p3, p4].map(({ id, name, elo }) => ({ id, name, elo })),
      rounds: {
        1: [
          createMatch({ id: 'm1', p1, p2, r1: 4, r2: 2, done: true, tbl: 1, format: 'fixed_rack' }),
          createMatch({ id: 'm2', p1: p3, p2: p4, r1: 0, r2: 0, done: false, tbl: 2, format: 'fixed_rack' })
        ]
      },
      currentRound: 1,
      ...overrides
    })
  });
};

// ---------------------------------------------------------------------------
// Basic behavior
// ---------------------------------------------------------------------------

test('assigns a new table to the targeted match only', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 5 });

  assert.equal(next.tournament.rounds[1][0].tbl, 5);
  assert.equal(next.tournament.rounds[1][1].tbl, 2); // untouched
});

test('overwrites an existing table assignment unconditionally', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 'Table B' });
  assert.equal(next.tournament.rounds[1][0].tbl, 'Table B');
});

test('preserves the exact type of the supplied table value (number or string), no coercion', () => {
  const state = twoMatchState();
  const withNumber = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 7 });
  assert.equal(typeof withNumber.tournament.rounds[1][0].tbl, 'number');
  assert.equal(withNumber.tournament.rounds[1][0].tbl, 7);

  const withString = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: '7' });
  assert.equal(typeof withString.tournament.rounds[1][0].tbl, 'string');
  assert.equal(withString.tournament.rounds[1][0].tbl, '7');
});

test('accepts an empty string (clearing the table), matching the current unvalidated text input', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: '' });
  assert.equal(next.tournament.rounds[1][0].tbl, '');
});

test('changing only tbl does not touch any other match field', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 9 });
  const { tbl: _before, ...beforeRest } = state.tournament.rounds[1][0];
  const { tbl: _after, ...afterRest } = next.tournament.rounds[1][0];
  assert.deepEqual(beforeRest, afterRest);
});

// ---------------------------------------------------------------------------
// Preserving observed current behavior exactly (no invented rules)
// ---------------------------------------------------------------------------

test('a completed (done: true) match\'s table remains changeable, matching the current UI (disabled only on cancelled, not done)', () => {
  const state = twoMatchState();
  assert.equal(state.tournament.rounds[1][0].done, true);
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 3 });
  assert.equal(next.tournament.rounds[1][0].tbl, 3);
  assert.equal(next.tournament.rounds[1][0].done, true); // unaffected
});

test('a cancelled match\'s table is still changeable at the data layer (the current "disabled" behavior is UI-only, not enforced in state)', () => {
  const state = twoMatchState();
  const cancelledState = {
    ...state,
    tournament: {
      ...state.tournament,
      rounds: { 1: state.tournament.rounds[1].map((m) => (m.id === 'm2' ? { ...m, cancelled: true } : m)) }
    }
  };
  const next = assignMatchTable(cancelledState, { roundNumber: 1, matchId: 'm2', table: 6 });
  assert.equal(next.tournament.rounds[1][1].tbl, 6);
});

test('does not enforce table uniqueness within a round, matching the absence of that check in current code', () => {
  const state = twoMatchState(); // m1 has tbl 1, m2 has tbl 2
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 2 }); // same as m2's table
  assert.equal(next.tournament.rounds[1][0].tbl, 2);
  assert.equal(next.tournament.rounds[1][1].tbl, 2);
});

// ---------------------------------------------------------------------------
// Purity / no mutation of input
// ---------------------------------------------------------------------------

test('does not mutate its ApplicationState input', () => {
  const state = twoMatchState();
  const snapshot = JSON.parse(JSON.stringify(state));
  assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 42 });
  assert.deepEqual(state, snapshot);
});

test('returns a new object graph down to the changed match (no shared references with the input for the changed path)', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 42 });

  assert.notEqual(next, state);
  assert.notEqual(next.tournament, state.tournament);
  assert.notEqual(next.tournament.rounds, state.tournament.rounds);
  assert.notEqual(next.tournament.rounds[1], state.tournament.rounds[1]);
  assert.notEqual(next.tournament.rounds[1][0], state.tournament.rounds[1][0]);
});

test('does not touch player/roster data or any other round', () => {
  const fullState = twoMatchState();
  const withSecondRound = {
    ...fullState,
    tournament: { ...fullState.tournament, rounds: { ...fullState.tournament.rounds, 2: [] } }
  };
  const next = assignMatchTable(withSecondRound, { roundNumber: 1, matchId: 'm1', table: 11 });

  assert.deepEqual(next.tournament.players, withSecondRound.tournament.players);
  assert.deepEqual(next.tournament.roster, withSecondRound.tournament.roster);
  assert.deepEqual(next.tournament.rounds[2], withSecondRound.tournament.rounds[2]);
});

// ---------------------------------------------------------------------------
// Not a BBS/pairing/round-lifecycle operation
// ---------------------------------------------------------------------------

test('the result remains a valid canonical ApplicationState', () => {
  const state = twoMatchState();
  const next = assignMatchTable(state, { roundNumber: 1, matchId: 'm1', table: 1 });
  assert.deepEqual(validateApplicationState(next), { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// Error handling for well-defined input
// ---------------------------------------------------------------------------

test('throws a clear error when the application is EMPTY (no tournament)', () => {
  assert.throws(() => assignMatchTable(createApplicationState(), { roundNumber: 1, matchId: 'm1', table: 1 }), /no tournament/);
});

test('throws a clear error when the round does not exist', () => {
  const state = twoMatchState();
  assert.throws(() => assignMatchTable(state, { roundNumber: 2, matchId: 'm1', table: 1 }), /round 2 does not exist/);
});

test('throws a clear error when the match does not exist in the round', () => {
  const state = twoMatchState();
  assert.throws(() => assignMatchTable(state, { roundNumber: 1, matchId: 'does-not-exist', table: 1 }), /does not exist in round/);
});

// ---------------------------------------------------------------------------
// Composition with the application store
// ---------------------------------------------------------------------------

test('composes with tournamentStore.updateState() to commit a table change', () => {
  const store = createTournamentStore(twoMatchState());
  store.updateState((current) => assignMatchTable(current, { roundNumber: 1, matchId: 'm2', table: 'Court 3' }));

  const state = store.getState();
  assert.equal(state.tournament.rounds[1][1].tbl, 'Court 3');
  assert.equal(state.tournament.rounds[1][0].tbl, 1); // untouched
});
