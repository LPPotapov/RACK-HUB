import assert from 'node:assert/strict';
import test from 'node:test';
import { draftScorePublishPair, parseDraftScoreField, publishDraftScoreChange, resolveScoreField } from '../src/canaletto/scoreEntry.js';
import { recordMatchResult } from '../src/application/tournamentCommands.js';
import { startTournament } from '../src/application/tournamentCommands.js';
import { createApplicationState, createConfig, createTournamentState } from '../src/domain/tournamentModel.js';

// draftScorePublishPair is the exact PUBLISHABILITY decision used by
// publishDraftScoreChange() (called directly from MatchRow/KoMatchCard's
// score-field onChange handlers — see scoreEntry.js). Aliased here as
// isDraftPublishable purely so the existing test names below (which predate
// the direct-handler pass) keep reading naturally.
const isDraftPublishable = draftScorePublishPair;

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
// the old publish gate's "both sides must be non-null" rule — was the root
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
// draftScorePublishPair's decision (isDraftPublishable above) — the ACTUAL
// boundary that was broken end-to-end. Reproduces the exact bug-report
// repro steps.
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

// ---------------------------------------------------------------------------
// publishDraftScoreChange — the actual function MatchRow/KoMatchCard's r1
// and r2 onChange handlers call DIRECTLY (urgent hotfix, direct-handler
// pass: native number-input stepper clicks were not reliably reaching the
// public page through the PRIOR useEffect-based debounce — see the
// live-draft investigation report). This is the boundary the score-field
// handler itself now owns: the event that changes the field is the exact
// call that decides whether/what to publish, with no effect/dependency
// array in between. `lastPublishedRef` mirrors the real `useRef(null)` each
// match-card instance owns.
// ---------------------------------------------------------------------------

test('publishDraftScoreChange: a Player A field change (r1) invokes onPublish with the new pair, Player B untouched/blank read as 0', () => {
  const published = [];
  const lastPublishedRef = { current: null };
  // Simulates MatchRow/KoMatchCard's handleR1Change: value=r1 just typed, r2 still blank.
  publishDraftScoreChange('1', '', lastPublishedRef, (n1, n2) => published.push([n1, n2]));
  assert.deepEqual(published, [[1, 0]]);
});

test('publishDraftScoreChange: a Player B field change (r2) invokes onPublish with the new pair, Player A untouched/blank read as 0', () => {
  const published = [];
  const lastPublishedRef = { current: null };
  // Simulates handleR2Change: value=r2 just typed, r1 still blank.
  publishDraftScoreChange('', '1', lastPublishedRef, (n1, n2) => published.push([n1, n2]));
  assert.deepEqual(published, [[0, 1]]);
});

test('publishDraftScoreChange: a full native-stepper sequence on canalettoTest publishes every distinct value exactly once, in order — 0-0 -> 1-0 -> 2-0 -> 2-1 -> 1-1', () => {
  const published = [];
  const lastPublishedRef = { current: null };
  const onPublish = (n1, n2) => published.push([n1, n2]);
  publishDraftScoreChange('1', '', lastPublishedRef, onPublish); // A up
  publishDraftScoreChange('2', '', lastPublishedRef, onPublish); // A up again
  publishDraftScoreChange('2', '1', lastPublishedRef, onPublish); // B up
  publishDraftScoreChange('1', '1', lastPublishedRef, onPublish); // A down
  assert.deepEqual(published, [[1, 0], [2, 0], [2, 1], [1, 1]]);
});

test('publishDraftScoreChange: an onChange firing with an unchanged pair is NOT re-published (equality guard), but a genuinely new value always is', () => {
  const published = [];
  const lastPublishedRef = { current: null };
  const onPublish = (n1, n2) => published.push([n1, n2]);
  publishDraftScoreChange('4', '3', lastPublishedRef, onPublish);
  publishDraftScoreChange('4', '3', lastPublishedRef, onPublish); // identical pair — skipped
  publishDraftScoreChange('4', '3', lastPublishedRef, onPublish); // identical pair — skipped
  publishDraftScoreChange('5', '3', lastPublishedRef, onPublish); // new value — published
  assert.deepEqual(published, [[4, 3], [5, 3]]);
});

test('publishDraftScoreChange: an unpublishable pair (both blank, or a malformed side) never invokes onPublish', () => {
  const published = [];
  const lastPublishedRef = { current: null };
  const onPublish = (n1, n2) => published.push([n1, n2]);
  publishDraftScoreChange('', '', lastPublishedRef, onPublish);
  publishDraftScoreChange('-1', '3', lastPublishedRef, onPublish);
  publishDraftScoreChange('4', '4.5', lastPublishedRef, onPublish);
  assert.deepEqual(published, []);
});

test('publishDraftScoreChange: a disabled/gated call site (onPublish undefined, e.g. editing=false or match.done) is a complete no-op', () => {
  const lastPublishedRef = { current: null };
  assert.doesNotThrow(() => publishDraftScoreChange('1', '0', lastPublishedRef, undefined));
  assert.equal(lastPublishedRef.current, null);
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
