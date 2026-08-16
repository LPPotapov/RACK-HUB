import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDraftScoreField, resolveScoreField } from '../src/canaletto/scoreEntry.js';
import { recordMatchResult } from '../src/application/tournamentCommands.js';
import { startTournament } from '../src/application/tournamentCommands.js';
import { createApplicationState, createConfig, createTournamentState } from '../src/domain/tournamentModel.js';

// react-free re-implementation of useDraftScorePublish's PUBLISHABILITY
// decision (the part that isn't the React effect/debounce plumbing itself)
// — this repo's `node --test` runner has no DOM/React renderer, so the hook
// itself is exercised indirectly here and directly via the live end-to-end
// helper-chain tests in canaletto-live.test.js/canaletto-public-state.test.js;
// this local helper isolates JUST the "is this (r1, r2) pair publishable"
// logic for focused regression coverage without needing a React harness.
const isDraftPublishable = (r1, r2) => {
  const bothBlank = String(r1 ?? '').trim() === '' && String(r2 ?? '').trim() === '';
  if (bothBlank) return null;
  const n1 = parseDraftScoreField(r1);
  const n2 = parseDraftScoreField(r2);
  if (n1 === null || n2 === null) return null;
  return [n1, n2];
};

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

// ---------------------------------------------------------------------------
// parseDraftScoreField (livescore hotfix, urgent bugfix pass) — matches
// resolveScoreField()'s blank->0 convention: an untouched side of an
// in-progress draft reads as 0, the same as it will at final Confirm. The
// PRIOR version returned `null` for a blank field, which — combined with
// useDraftScorePublish's "both sides must be non-null" gate — was the root
// cause of the reported end-to-end break: clicking the native number
// input's up-arrow on only ONE side (leaving the other blank) silently
// never published anything at all.
// ---------------------------------------------------------------------------

test('parseDraftScoreField: a blank/whitespace field reads as 0 (untouched side of an in-progress draft, same convention as resolveScoreField at Confirm)', () => {
  assert.equal(parseDraftScoreField(''), 0);
  assert.equal(parseDraftScoreField('   '), 0);
  assert.equal(parseDraftScoreField(undefined), 0);
});

test('parseDraftScoreField: a valid non-negative integer passes through unchanged', () => {
  assert.equal(parseDraftScoreField('0'), 0);
  assert.equal(parseDraftScoreField('6'), 6);
  assert.equal(parseDraftScoreField('42'), 42);
});

test('parseDraftScoreField: negative, non-integer, and non-numeric input never publish', () => {
  assert.equal(parseDraftScoreField('-1'), null);
  assert.equal(parseDraftScoreField('4.5'), null);
  assert.equal(parseDraftScoreField('abc'), null);
});

// ---------------------------------------------------------------------------
// useDraftScorePublish's publishability decision (isDraftPublishable above)
// — the ACTUAL boundary that was broken end-to-end. Reproduces the exact
// bug-report repro steps.
// ---------------------------------------------------------------------------

test('BUG REPRO (fixed): clicking the up-arrow on only ONE side (other still blank) is now publishable, treating the untouched side as 0 — "0-0 -> click up -> 1-0"', () => {
  assert.deepEqual(isDraftPublishable('1', ''), [1, 0]);
  assert.deepEqual(isDraftPublishable('', '1'), [0, 1]);
});

test('a genuinely untouched pair (both blank — e.g. every other pending match in the round, whose card merely rendered) is NOT publishable — never floods a "0-0" draft for matches nobody is scoring', () => {
  assert.equal(isDraftPublishable('', ''), null);
  assert.equal(isDraftPublishable('   ', ''), null);
});

test('both sides explicitly entered is publishable ("type 4 and 3" -> 4-3)', () => {
  assert.deepEqual(isDraftPublishable('4', '3'), [4, 3]);
});

test('incremental KO race-to sequence is publishable at every step: 1-0, 1-1, 2-1, ... 6-6', () => {
  assert.deepEqual(isDraftPublishable('1', ''), [1, 0]);
  assert.deepEqual(isDraftPublishable('1', '1'), [1, 1]);
  assert.deepEqual(isDraftPublishable('2', '1'), [2, 1]);
  assert.deepEqual(isDraftPublishable('6', '6'), [6, 6]);
  assert.deepEqual(isDraftPublishable('7', '6'), [7, 6]); // race-to-7 win, still NOT auto-confirmed by this layer
});

test('a malformed non-blank side (negative/non-integer) still blocks publishing entirely, even when the other side is valid', () => {
  assert.equal(isDraftPublishable('-1', '3'), null);
  assert.equal(isDraftPublishable('4', '4.5'), null);
  assert.equal(isDraftPublishable('abc', '3'), null);
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
