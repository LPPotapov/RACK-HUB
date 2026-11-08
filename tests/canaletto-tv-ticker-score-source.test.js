// TV/MATCH TICKER SCORE SOURCE FIX (+ realtime-draft follow-up) — before
// the first fix, TvOverlayPage.jsx showed ONLY the independent manual
// `tvScores` value for the selected match's score, regardless of whether
// the director had confirmed an official result or was mid-way through
// entering one as a live draft.
//
// The first fix's resolveTvDisplayScore(resolvedMatch, liveState) looked
// for the draft on `liveState.liveDraftScores` — but `liveState` is the
// `/live` RTDB node (tvMatch + manual tvScores ONLY; it never carries
// liveDraftScores). The director's draft actually reaches Firebase
// correctly via useCanalettoCloudMirror.js's fast path, which calls
// derivePublicState(event, liveState) and writes the result to
// `publicState` — so `liveDraftScores` lives on the PUBLIC EVENT
// (`event.liveDraftScores`), never on `/live`. The draft WAS reaching
// Firebase the whole time; the ticker was just reading the wrong node for
// it, which is why it only ever showed whatever score happened to be
// present at first render and never updated afterward.
//
// The fix changes the signature to
// resolveTvDisplayScore(resolvedMatch, publicEvent, liveState) and reads
// the draft from `publicEvent` (via the SAME getLiveDraftScore()/
// tvMatchKey() identity every Block/KO match card and public Livescore
// page already use), using `liveState.tvMatch` only as the POINTER.
//
// This repo's test runner (`node --test`) has no JSX/DOM rendering
// support. To actually catch a wiring bug like this one — the PREVIOUS
// version of this file's pure-resolver tests all passed even though the
// real wiring was broken — every test below builds its "public event"
// via the REAL production pipeline (setLiveDraftScore on a LOCAL director
// liveState, then derivePublicState(event, thatLiveState)) rather than
// hand-constructing `event.liveDraftScores` directly, so a regression in
// EITHER derivePublicState's field name/shape OR resolveTvDisplayScore's
// own lookup would be caught here.

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
import { derivePublicState } from '../src/application/canalettoPublicState.js';

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

// Mirrors useCanalettoCloudMirror.js's real fast-path EXACTLY: the
// director's LOCAL liveState gets a draft set, then the whole thing is run
// through derivePublicState() — the same function that is actually
// writePublicState()'d to Firebase. This is what a TvOverlayPage's own
// `event` (from useCloudPublicEvent(), i.e. Firebase's `publicState`)
// looks like after a director types a draft score.
const publicEventWithDraft = (event, pointer, { r1, r2 }) => {
  const localDirectorLiveState = setLiveDraftScore(createCanalettoLiveState(), pointer, { r1, r2 });
  return derivePublicState(event, localDirectorLiveState);
};

// The SEPARATE `/live` RTDB node state — tvMatch selection + optional
// manual tvScores ONLY, exactly what useCloudLiveState() subscribes to.
// Never shares an object with the director's local liveState above.
const cloudLiveNode = (pointer) => selectTvMatch(createCanalettoLiveState(), pointer);

// ---------------------------------------------------------------------------
// 1. Public draft 3-2 -> ticker resolves 3-2 (the exact realtime-draft bug)
// ---------------------------------------------------------------------------

test('a public-event draft of 3-2 resolves to 3-2 on the ticker, reading from the PUBLIC EVENT, not from liveState', () => {
  const event = readyBlockEvent();
  const match = event.blockA.tournament.rounds[1][0];
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId: match.id };

  const publicEvent = publicEventWithDraft(event, pointer, { r1: 3, r2: 2 });
  const liveState = cloudLiveNode(pointer); // /live — NEVER carries liveDraftScores

  assert.deepEqual(liveState.liveDraftScores, {}, 'sanity: the /live-shaped state must never itself carry the draft');
  const resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 3, r2: 2 });
});

// ---------------------------------------------------------------------------
// 2. The SAME event object updated to a NEW draft (4-2) resolves 4-2 —
// proving the resolver reacts to whatever the public event currently says,
// exactly like a fresh Firebase listener callback would deliver, with no
// manual refresh or extra state recreation required on the caller's part.
// ---------------------------------------------------------------------------

test('updating the public event to a NEW draft (4-2) changes what the ticker resolves to, with no extra state/cache to invalidate', () => {
  const event = readyBlockEvent();
  const match = event.blockA.tournament.rounds[1][0];
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId: match.id };
  const liveState = cloudLiveNode(pointer);

  const publicEventV1 = publicEventWithDraft(event, pointer, { r1: 3, r2: 2 });
  const resolvedV1 = resolveTvMatch(publicEventV1, liveState);
  assert.deepEqual(resolveTvDisplayScore(resolvedV1, publicEventV1, liveState), { r1: 3, r2: 2 });

  // A new Firebase `publicState` snapshot arrives (director incremented the
  // draft by one rack) — a brand NEW event object, exactly like a listener
  // callback hands TvOverlayPage a new `event` on every change.
  const publicEventV2 = publicEventWithDraft(event, pointer, { r1: 4, r2: 2 });
  const resolvedV2 = resolveTvMatch(publicEventV2, liveState);
  assert.deepEqual(resolveTvDisplayScore(resolvedV2, publicEventV2, liveState), { r1: 4, r2: 2 });
});

// ---------------------------------------------------------------------------
// 3 & 4. Confirmed match 7-5 -> ticker shows OFFICIAL 7-5, beating a stale
// public draft still technically present underneath it.
// ---------------------------------------------------------------------------

test('a confirmed BLOCK match shows the OFFICIAL score, even with a stale public draft still present underneath', () => {
  let event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };
  const liveState = cloudLiveNode(pointer);

  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId, r1: 7, r2: 1 });
  // A stale draft (from before confirmation) is still sitting in publicState.
  const publicEvent = publicEventWithDraft(event, pointer, { r1: 3, r2: 2 });

  const resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved.done, true);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 7, r2: 1 }, 'official result must win over the stale draft');
});

test('official result ALSO beats a manual tvScores override that was set for broadcast purposes', () => {
  let event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = cloudLiveNode(pointer);
  liveState = setTvScore(liveState, { r1: 9, r2: 9 }); // streaming staff's own manual override

  event = recordBlockMatchResult(event, 'A', { roundNumber: 1, matchId, r1: 6, r2: 2 });
  const publicEvent = derivePublicState(event, createCanalettoLiveState()); // no draft at all

  const resolved = resolveTvMatch(publicEvent, liveState);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 6, r2: 2 }, 'official result must win over a manual broadcast override too');
});

test('the manual tvScores override IS shown as the last resort when neither an official result nor a public draft exists', () => {
  const event = readyBlockEvent();
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  let liveState = cloudLiveNode(pointer);
  liveState = setTvScore(liveState, { r1: 2, r2: 1 });
  const publicEvent = derivePublicState(event, createCanalettoLiveState()); // no draft at all

  const resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 2, r2: 1 }, 'manual override must still work when nothing more authoritative exists');
});

test('with nothing selected/set at all, the ticker shows a sensible 0-0', () => {
  const event = readyBlockEvent();
  const publicEvent = derivePublicState(event, createCanalettoLiveState());
  const liveState = createCanalettoLiveState();
  const resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved, null);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 0, r2: 0 });
});

// ---------------------------------------------------------------------------
// 5. Block AND KO pointers both work, through the SAME resolver/key logic.
// ---------------------------------------------------------------------------

test('a KO (Top16) match pointer resolves the public draft/official score identically to a Block pointer', () => {
  let event = readyTop16Event();
  const match = event.ko.top16.matches[0];
  const pointer = { source: 'ko', stage: 'top16', matchNumber: match.matchNumber };
  const liveState = cloudLiveNode(pointer);

  let publicEvent = publicEventWithDraft(event, pointer, { r1: 4, r2: 1 });
  let resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved.done, false);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 4, r2: 1 });

  // Now confirm it officially — official must win, even with the stale
  // draft still present in whatever publicState snapshot arrives next.
  event = recordKoResult(event, 'top16', { matchNumber: match.matchNumber, r1: 7, r2: 3 });
  publicEvent = publicEventWithDraft(event, pointer, { r1: 4, r2: 1 });
  resolved = resolveTvMatch(publicEvent, liveState);
  assert.equal(resolved.done, true);
  assert.deepEqual(resolveTvDisplayScore(resolved, publicEvent, liveState), { r1: 7, r2: 3 });
});

// ---------------------------------------------------------------------------
// 6. Score display never marks a match done / never touches official state.
// ---------------------------------------------------------------------------

test('resolveTvDisplayScore is pure: showing a draft never marks the underlying match done or changes its official r1/r2', () => {
  const event = readyBlockEvent();
  const matchBefore = JSON.stringify(event.blockA.tournament.rounds[1][0]);
  const matchId = event.blockA.tournament.rounds[1][0].id;
  const pointer = { source: 'block', block: 'A', roundNumber: 1, matchId };

  const publicEvent = publicEventWithDraft(event, pointer, { r1: 3, r2: 2 });
  const liveState = cloudLiveNode(pointer);

  const resolved = resolveTvMatch(publicEvent, liveState);
  resolveTvDisplayScore(resolved, publicEvent, liveState); // display call only

  assert.equal(JSON.stringify(event.blockA.tournament.rounds[1][0]), matchBefore, 'the underlying match must be completely untouched by a display-only resolution');
});

// ---------------------------------------------------------------------------
// Workspace namespace isolation — unaffected by this fix, but re-asserted
// here since this file's whole premise is "the previous pure-resolver
// tests passed while the real wiring was wrong"; the same caution applies
// to namespace routing, so it's worth a direct check alongside the fix.
// ---------------------------------------------------------------------------

test('TvOverlayPage.jsx and TvScoreControlPage.jsx resolve BOTH event and liveState through useCloudPublicEvent()/useCloudLiveState() — no second/independent path, no canaletto2026 fallback', () => {
  const overlaySource = readFileSync(path.join(__dirname, '../src/canaletto/live/TvOverlayPage.jsx'), 'utf8');
  const controlSource = readFileSync(path.join(__dirname, '../src/canaletto/live/TvScoreControlPage.jsx'), 'utf8');
  [overlaySource, controlSource].forEach((source) => {
    assert.ok(source.includes('useCloudPublicEvent'), 'must use useCloudPublicEvent() for the public event');
    assert.ok(source.includes('useCloudLiveState'), 'must use useCloudLiveState() for /live');
    assert.ok(!/events\/canaletto(2026|Test)/.test(source), 'must never hardcode a literal events/canaletto2026 or events/canalettoTest path');
  });
});

// ---------------------------------------------------------------------------
// Source-scan: both pages pass the CORRECTED 3-argument signature.
// ---------------------------------------------------------------------------

test('TvOverlayPage.jsx calls resolveTvDisplayScore(resolved, event, liveState) — the corrected 3-argument signature', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/TvOverlayPage.jsx'), 'utf8');
  assert.ok(/resolveTvDisplayScore\(\s*resolved\s*,\s*event\s*,\s*liveState\s*\)/.test(source), 'TvOverlayPage.jsx must call resolveTvDisplayScore(resolved, event, liveState)');
  assert.ok(!/const score = getCurrentTvScore\(/.test(source), 'TvOverlayPage.jsx must not resolve its displayed score via a bare getCurrentTvScore() call');
});

test('TvScoreControlPage.jsx calls resolveTvDisplayScore(resolved, event, liveState) — the corrected 3-argument signature', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/TvScoreControlPage.jsx'), 'utf8');
  assert.ok(/resolveTvDisplayScore\(\s*resolved\s*,\s*event\s*,\s*liveState\s*\)/.test(source), 'TvScoreControlPage.jsx must call resolveTvDisplayScore(resolved, event, liveState)');
});
