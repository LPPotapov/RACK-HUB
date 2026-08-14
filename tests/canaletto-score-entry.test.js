import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScoreField } from '../src/canaletto/scoreEntry.js';
import { recordMatchResult } from '../src/application/tournamentCommands.js';
import { startTournament } from '../src/application/tournamentCommands.js';
import { createApplicationState, createConfig, createTournamentState } from '../src/domain/tournamentModel.js';

test('resolveScoreField: an untouched/blank field resolves to the canonical missing value (0)', () => {
  assert.equal(resolveScoreField(''), 0);
  assert.equal(resolveScoreField('   '), 0);
  assert.equal(resolveScoreField(undefined), 0);
});

test('resolveScoreField: a typed integer passes through unchanged', () => {
  assert.equal(resolveScoreField('6'), 6);
  assert.equal(resolveScoreField('0'), 0);
});

test('resolveScoreField: non-integer input is rejected (null), never silently coerced', () => {
  assert.equal(resolveScoreField('4.5'), null);
  assert.equal(resolveScoreField('abc'), null);
});

// End-to-end proof of the actual UX fix: entering ONLY one score (the other
// field left blank -> resolveScoreField('') -> 0) and calling
// recordMatchResult() with that 0 produces the exact same autocompleted
// result the director expects, via the EXISTING command's own autocomplete
// — no formula duplicated here.
test('one score + untouched opposite field autocompletes via the existing recordMatchResult() contract', () => {
  const config = createConfig({ max_games: 8 });
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  let applicationState = createApplicationState({
    tournament: createTournamentState({ started: false, config, roster, currentRound: 0 })
  });
  applicationState = startTournament(applicationState, { seedMethod: 'random' });
  const match = applicationState.tournament.rounds[1][0];

  const r1 = resolveScoreField('6');
  const r2 = resolveScoreField(''); // untouched
  const result = recordMatchResult(applicationState, { roundNumber: 1, matchId: match.id, r1, r2 });
  const updated = result.tournament.rounds[1][0];
  assert.equal(updated.r1, 6);
  assert.equal(updated.r2, 2); // 8 - 6, via recordMatchResult()'s own autocomplete
  assert.equal(updated.done, true);
});

test('both fields blank still rejects, per the existing recordMatchResult() rule', () => {
  const config = createConfig({ max_games: 8 });
  const roster = [{ id: 1, name: 'Alpha', elo: 1600 }, { id: 2, name: 'Bravo', elo: 1500 }];
  let applicationState = createApplicationState({
    tournament: createTournamentState({ started: false, config, roster, currentRound: 0 })
  });
  applicationState = startTournament(applicationState, { seedMethod: 'random' });
  const match = applicationState.tournament.rounds[1][0];

  const r1 = resolveScoreField('');
  const r2 = resolveScoreField('');
  assert.throws(() => recordMatchResult(applicationState, { roundNumber: 1, matchId: match.id, r1, r2 }), /at least one score/);
});
