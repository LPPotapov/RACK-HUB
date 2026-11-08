// TV/MATCH TICKER SCORE SOURCE FIX — before this fix, TvOverlayPage.jsx
// showed ONLY the independent manual `tvScores` value (getCurrentTvScore())
// for the selected match's score, regardless of whether the director had
// already confirmed an official result or was mid-way through entering one
// as a live draft. The overlay correctly resolved the SELECTED MATCH and
// PLAYER NAMES (resolveTvMatch already read the authoritative event), but
// the SCORE was a completely separate, never-written-to field — so a
// director's official/draft score simply never appeared on the ticker.
//
// The fix adds resolveTvDisplayScore(resolvedMatch, liveState)
// (canalettoLive.js): official result once confirmed (always wins) ->
// director's live draft (same getLiveDraftScore()/tvMatchKey() identity
// every Block/KO match card already uses) -> the independent manual
// tvScores value, now only a last-resort fallback -> 0-0.
//
// This repo's test runner (`node --test`) has no JSX/DOM rendering support,
// so (matching every sibling draft-score test file's approach) this
// exercises the real domain/application functions end-to-end plus a
// source-scan proving TvOverlayPage.jsx actually calls the new resolver.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  addPlayerToBlock,
  createCanalettoEvent,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startTop16
} from '../src/application/canalettoEvent.js';
import {
  createCanalettoLiveState,
  resolveTvDisplayScore,
  resolveTvMatch,
  selectTvMatch,
  setLiveDraftScore,
  setTvScore
} from '../src/application/canalettoLive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}` }));

// Minimal real event with ONE Block A, round 1 match, ready to score.
const readyBlockEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 2 });
  event = setEventTables(event, tablesOf(2));
  event = addPlayerToBlock(event, 'A', { id: 1, name: 'Alice', elo: 1600 });
  event = addPlayerToBlock(event, 'A', { id: 2, name: 'Bob', elo: 1500 });
  event = startBlock(event, 'A');
  return event;
};

// Minimal real event with a generated Top16 (ONE KO match), ready to score.
const readyTop16Event = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  ['A', 'B'].forEach((block) => {
    event[`block${block}`].tournament.rounds[1].forEach((m) => {
      event = recordBlockMatchResult(event, block, { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  return startTop16(event);
};

// ---------------------------------------------------------------------------
// 1. Selected unconfirmed Block match + draft 3-2 -> ticker shows 3-2
// ---------------------------------------------------------------------------

test('a selected, unconfirmed BLOCK match with a 3-2 director draft resolves to 3-2 on the ticker', () => {
  const event = readyBlockEvent();
  const match = event.blockA.tournament.rounds[1][0];
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId: match.id };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });

  const resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 3, r2: 2 });
});

// ---------------------------------------------------------------------------
// 2. Draft survives "switching tabs" — i.e. the SAME liveState object is
// still readable/unchanged by resolveTvDisplayScore after a simulated
// remount (represented here by simply re-deriving `resolved` fresh, as a
// freshly-mounted TvOverlayPage would).
// ---------------------------------------------------------------------------

test('the draft is still readable (ticker still shows 3-2) after a simulated remount — resolveTvDisplayScore never mutates liveState', () => {
  const event = readyBlockEvent();
  const match = event.blockA.tournament.rounds[1][0];
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId: match.id };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });
  const liveStateJsonBefore = JSON.stringify(liveState);

  // Simulate a fresh TvOverlayPage mount re-deriving everything from scratch.
  const resolvedAgain = resolveTvMatch(event, liveState);
  const scoreAgain = resolveTvDisplayScore(resolvedAgain, liveState);

  assert.deepEqual(scoreAgain, { r1: 3, r2: 2 });
  assert.equal(JSON.stringify(liveState), liveStateJsonBefore, 'resolveTvMatch/resolveTvDisplayScore must never mutate liveState');
});

// ---------------------------------------------------------------------------
// 3 & 4. Confirmed match 7-5 -> ticker shows OFFICIAL 7-5, beating a stale
// draft that still technically exists underneath it.
// ---------------------------------------------------------------------------

test('a confirmed BLOCK match shows the OFFICIAL score, even with a stale draft still present underneath', () => {
  let event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 }); // stale — director later confirmed something else

  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId, r1: 7, r2: 1 });

  const resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.done, true);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 7, r2: 1 }, 'official result must win over the stale draft');
});

test('official result ALSO beats a manual tvScores override that was set for broadcast purposes', () => {
  let event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setTvScore(liveState, { r1: 9, r2: 9 }); // streaming staff's own manual override

  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId, r1: 6, r2: 2 });

  const resolved = resolveTvMatch(event, liveState);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 6, r2: 2 }, 'official result must win over a manual broadcast override too');
});

test('the manual tvScores override IS shown as the last resort when neither an official result nor a draft exists', () => {
  const event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setTvScore(liveState, { r1: 2, r2: 1 });

  const resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 2, r2: 1 }, 'manual override must still work when nothing more authoritative exists');
});

test('with nothing selected/set at all, the ticker shows a sensible 0-0', () => {
  const event = readyBlockEvent();
  const liveState = createCanalettoLiveState();
  const resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved, null);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 0, r2: 0 });
});

// ---------------------------------------------------------------------------
// 5. Block AND KO pointers both work, through the SAME resolver/key logic.
// ---------------------------------------------------------------------------

test('a KO (Top16) match pointer resolves the draft/official score identically to a Block pointer', () => {
  let event = readyTop16Event();
  const match = event.ko.top16.matches[0];
  const pointer = { source: 'ko', stage: 'top16', matchNumber: match.matchNumber };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setLiveDraftScore(liveState, pointer, { r1: 4, r2: 1 });

  let resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 4, r2: 1 });

  // Now confirm it officially — official must win.
  event = recordKoResult(event, 'top16', { matchNumber: match.matchNumber, r1: 7, r2: 3 });
  resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.done, true);
  assert.deepEqual(resolveTvDisplayScore(resolved, liveState), { r1: 7, r2: 3 });
});

// ---------------------------------------------------------------------------
// 6. Score display never marks a match done / never touches official state.
// ---------------------------------------------------------------------------

test('resolveTvDisplayScore is pure: showing a draft never marks the underlying match done or changes its official r1/r2', () => {
  const event = readyBlockEvent();
  const matchBefore = JSON.stringify(event.blockA.tournament.rounds[1][0]);
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = createCanalettoLiveState();
  liveState = selectTvMatch(liveState, pointer);
  liveState = setLiveDraftScore(liveState, pointer, { r1: 3, r2: 2 });

  const resolved = resolveTvMatch(event, liveState);
  resolveTvDisplayScore(resolved, liveState); // display call only

  assert.equal(JSON.stringify(event.blockA.tournament.rounds[1][0]), matchBefore, 'the underlying match must be completely untouched by a display-only resolution');
});

// ---------------------------------------------------------------------------
// Source-scan: TvOverlayPage.jsx actually calls the new resolver.
// ---------------------------------------------------------------------------

test('TvOverlayPage.jsx resolves its score via resolveTvDisplayScore, not a bare getCurrentTvScore() call', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/TvOverlayPage.jsx'), 'utf8');
  assert.ok(/resolveTvDisplayScore\(/.test(source), 'TvOverlayPage.jsx must call resolveTvDisplayScore(...)');
  assert.ok(!/const score = getCurrentTvScore\(/.test(source), 'TvOverlayPage.jsx must not resolve its displayed score via a bare getCurrentTvScore() call');
});
