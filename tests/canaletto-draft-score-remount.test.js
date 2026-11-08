// DRAFT SCORE REMOUNT BUG (urgent fix, "WORKSPACE NOT RECEIVING DIRECTOR
// STATE + DRAFT SCORE REMOUNT BUG") — before this fix, MatchRow (ui.jsx)
// and KoMatchCard (koUi.jsx) could only WRITE a live draft score
// (onDraftChange/onDraftClear) but never READ one back: their input
// state's initializer and reset-effect always seeded `''` for any
// unconfirmed match, regardless of whether a draft already existed in
// `liveState.liveDraftScores`. Switching tabs/sections (Round 1 -> Round 2
// -> back to Round 1) unmounts and remounts the whole round view, so a
// fresh `useState` initializer ran with no knowledge of the draft at all —
// an in-progress, unconfirmed score was silently lost on every remount.
//
// The fix extracts the shared seed logic into one pure, exported function
// (scoreEntry.js's seedScoreField()) used by both MatchRow and
// KoMatchCard, and threads the existing (already-local, Firebase-free)
// `liveState` down through RoundView (BlockPage.jsx) and
// StageOperationPanel/MatchGrid (Top16Page.jsx) so a `draftScore` lookup
// is actually available to pass in.
//
// This repo's test runner (`node --test`) has no JSX/DOM rendering support
// (see tests/canaletto-live.test.js's own note), so — exactly like the
// sibling tests/canaletto-ko-live-draft.test.js regression for the same
// draft-publishing mechanism — this file combines (1) pure unit tests of
// the extracted seedScoreField() logic, (2) an end-to-end pure-data test of
// the full setLiveDraftScore -> getLiveDraftScore -> seedScoreField chain,
// (3) source-scan tests proving MatchRow/KoMatchCard actually call
// seedScoreField (not just that the helper exists unused), and (4) a
// domain-level test proving a draft can never become an official result.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  addPlayerToBlock,
  createCanalettoEvent,
  recordBlockMatchResult,
  setEventTables,
  startBlock
} from '../src/application/canalettoEvent.js';
import { createCanalettoLiveState, getLiveDraftScore, setLiveDraftScore } from '../src/application/canalettoLive.js';
import { seedScoreField } from '../src/canaletto/scoreEntry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// seedScoreField() — pure unit tests
// ---------------------------------------------------------------------------

test('seedScoreField: a DONE match always shows the official value, even if a (necessarily stale) draft is also present', () => {
  assert.equal(seedScoreField(true, 7, 3), '7');
  assert.equal(seedScoreField(true, 0, undefined), '0');
});

test('seedScoreField: an UNCONFIRMED match with an existing draft shows the draft', () => {
  assert.equal(seedScoreField(false, 0, 3), '3');
  assert.equal(seedScoreField(false, undefined, 0), '0'); // 0 is a real draft value, not "no draft"
});

test('seedScoreField: an UNCONFIRMED match with no draft (null/undefined) shows blank', () => {
  assert.equal(seedScoreField(false, 0, null), '');
  assert.equal(seedScoreField(false, 0, undefined), '');
});

// ---------------------------------------------------------------------------
// End-to-end: setLiveDraftScore -> getLiveDraftScore -> seedScoreField,
// exactly the chain a remounting MatchRow/KoMatchCard now runs.
// ---------------------------------------------------------------------------

test('a draft set via setLiveDraftScore() is retrievable via getLiveDraftScore() and seeds the input exactly as a remount would', () => {
  let liveState = createCanalettoLiveState();
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId: 42 };
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });

  const draft = getLiveDraftScore(liveState, pointer);
  assert.equal(draft.r1, 3);
  assert.equal(draft.r2, 2);

  // Simulating a fresh MatchRow mount after a tab switch: match.done is
  // still false (unconfirmed), and the draft must still seed the fields.
  assert.equal(seedScoreField(false, 0, draft.r1), '3');
  assert.equal(seedScoreField(false, 0, draft.r2), '2');
});

test('a KO draft (different pointer shape) round-trips the same way', () => {
  let liveState = createCanalettoLiveState();
  const pointer = { source: 'ko', stage: 'quarterfinals', matchNumber: 2 };
  liveState = setLiveDraftScore(liveState, pointer, { r1: 5, r2: 4 });

  const draft = getLiveDraftScore(liveState, pointer);
  assert.equal(seedScoreField(false, 0, draft.r1), '5');
  assert.equal(seedScoreField(false, 0, draft.r2), '4');
});

test('a draft can NEVER become an official result: recordBlockMatchResult always wins regardless of whatever draft exists', () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 2 });
  event = setEventTables(event, [{ order: 1, label: 'Table 1' }]);
  event = addPlayerToBlock(event, 'A', { id: 1, name: 'Player 1', elo: 1500 });
  event = addPlayerToBlock(event, 'A', { id: 2, name: 'Player 2', elo: 1500 });
  event = startBlock(event, 'A');
  const matchId = event.blockA.tournament.rounds[1][0].id;

  // A draft of 3-2 (racksPerMatch=8 total) exists, but the director
  // ultimately confirms a DIFFERENT result, 5-3 (also totaling 8).
  let liveState = createCanalettoLiveState();
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });

  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId, r1: 5, r2: 3 });
  const match = event.blockA.tournament.rounds[1].find((m) => m.id === matchId);
  assert.equal(match.done, true);
  assert.equal(match.r1, 5);
  assert.equal(match.r2, 3);

  // seedScoreField for a now-done match must show the OFFICIAL result, not
  // the stale draft, even though getLiveDraftScore() still technically has
  // it (clearing it is the caller's/onDraftClear's job, not this helper's).
  const draft = getLiveDraftScore(liveState, pointer);
  assert.equal(draft.r1, 3);
  assert.equal(draft.r2, 2);
  assert.equal(seedScoreField(match.done, match.r1, draft.r1), '5');
  assert.equal(seedScoreField(match.done, match.r2, draft.r2), '3');
});

// ---------------------------------------------------------------------------
// Source-scan: prove MatchRow/KoMatchCard actually CALL seedScoreField
// (both in their useState initializer AND their reset-effect), not merely
// that the helper exists unused somewhere.
// ---------------------------------------------------------------------------

test('ui.jsx MatchRow seeds its score inputs via seedScoreField, both on initial mount and in its match-identity reset effect', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/ui.jsx'), 'utf8');
  const matchRowSource = source.slice(source.indexOf('export const MatchRow'), source.indexOf('export const MatchRow') + 2000);
  const seedCalls = matchRowSource.match(/seedScoreField\(/g);
  assert.ok(seedCalls && seedCalls.length >= 4, `expected at least 4 seedScoreField() calls (r1/r2 x initial-state/effect) in MatchRow, found ${seedCalls?.length ?? 0}`);
  assert.ok(/draftScore/.test(matchRowSource), 'MatchRow must accept a draftScore prop');
});

test('koUi.jsx KoMatchCard seeds its score inputs via seedScoreField, both on initial mount and in its match-identity reset effect', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/koUi.jsx'), 'utf8');
  const cardSource = source.slice(source.indexOf('export const KoMatchCard'), source.indexOf('export const KoMatchCard') + 2000);
  const seedCalls = cardSource.match(/seedScoreField\(/g);
  assert.ok(seedCalls && seedCalls.length >= 4, `expected at least 4 seedScoreField() calls (r1/r2 x initial-state/effect) in KoMatchCard, found ${seedCalls?.length ?? 0}`);
  assert.ok(/draftScore/.test(cardSource), 'KoMatchCard must accept a draftScore prop');
});

test('BlockPage.jsx RoundView passes a draftScore lookup into <MatchRow>', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/pages/BlockPage.jsx'), 'utf8');
  const matchRowCall = source.match(/<MatchRow\b[\s\S]*?\/>/);
  assert.ok(matchRowCall, 'expected a <MatchRow> render site in BlockPage.jsx');
  assert.ok(/draftScore=\{.*getLiveDraftScore\(/.test(matchRowCall[0]), `<MatchRow> must pass draftScore={...getLiveDraftScore(...)...}:\n${matchRowCall[0]}`);
});
