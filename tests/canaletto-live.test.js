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
  setEventTables,
  startBlock,
  startTop16
} from '../src/application/canalettoEvent.js';
import {
  clearTvMatch,
  createCanalettoLiveState,
  getCurrentTvScore,
  getTvSelectableMatches,
  isSelectedTvRow,
  PREFERRED_TV_TABLE_LABEL,
  resolveTvMatch,
  selectTvMatch,
  setTvScore,
  tvMatchKey,
  validateCanalettoLiveState
} from '../src/application/canalettoLive.js';
import { buildLiveUrl, LIVE_LINKS } from '../src/canaletto/live/liveLinks.js';
import { OVERLAY_PANEL_CLASS, OVERLAY_SHELL_OUTER_CLASS } from '../src/canaletto/live/overlayShell.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: null, scoreLink: null }));
// First table is the event's preferred TV table, for 301-TV-identification tests.
const tablesWithPreferredTv = (n) => Array.from({ length: n }, (_, i) => ({
  order: i + 1,
  label: i === 0 ? PREFERRED_TV_TABLE_LABEL : `Table ${i + 1}`,
  billardPadId: null,
  scoreLink: null
}));

const eventWithBlockARunning = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesWithPreferredTv(12));
  rosterOf(8).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  return startBlock(event, 'A');
};

const eventWithTop16Started = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  ['A', 'B'].forEach((block) => {
    const key = `block${block}`;
    event[key].tournament.rounds[1].forEach((m) => {
      event = recordBlockMatchResult(event, block, { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  return startTop16(event);
};

// ---------------------------------------------------------------------------
// createCanalettoLiveState
// ---------------------------------------------------------------------------

test('createCanalettoLiveState returns a fresh state with no TV match and no stored scores', () => {
  const state = createCanalettoLiveState();
  assert.equal(state.tvMatch, null);
  assert.deepEqual(state.tvScores, {});
  assert.deepEqual(getCurrentTvScore(state), { r1: 0, r2: 0 });
  assert.equal(validateCanalettoLiveState(state).valid, true);
});

// ---------------------------------------------------------------------------
// selectTvMatch — KO pointer
// ---------------------------------------------------------------------------

test('selectTvMatch sets a KO pointer and does NOT reset a differently-selected match\'s score (per-match scores)', () => {
  let state = createCanalettoLiveState();
  state = setTvScore(selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 3 }), { r1: 5, r2: 2 });
  const next = selectTvMatch(state, { source: 'ko', stage: 'quarterfinals', matchNumber: 1 });
  assert.deepEqual(next.tvMatch, { source: 'ko', stage: 'quarterfinals', matchNumber: 1 });
  // The newly-selected match has no score of its own yet.
  assert.deepEqual(getCurrentTvScore(next), { r1: 0, r2: 0 });
  // But the PREVIOUS match's score is still stored, untouched.
  assert.deepEqual(next.tvScores['ko:top16:3'], { r1: 5, r2: 2 });
});

test('selectTvMatch rejects an invalid KO stage', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => selectTvMatch(state, { source: 'ko', stage: 'not-a-stage', matchNumber: 1 }), /invalid stage/);
});

test('selectTvMatch rejects a non-positive-integer KO matchNumber', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 0 }), /matchNumber/);
  assert.throws(() => selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 1.5 }), /matchNumber/);
});

test('selectTvMatch does not mutate its input state', () => {
  const state = createCanalettoLiveState();
  const frozen = JSON.parse(JSON.stringify(state));
  selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 1 });
  assert.deepEqual(state, frozen);
});

test('selectTvMatch rejects a pointer with no recognized source', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => selectTvMatch(state, { stage: 'top16', matchNumber: 1 }), /source/);
  assert.throws(() => selectTvMatch(state, { source: 'blockA', matchNumber: 1 }), /source/);
});

// ---------------------------------------------------------------------------
// selectTvMatch — Block pointer (director correction pass: TV must work for
// the entire event, not just KO)
// ---------------------------------------------------------------------------

test('selectTvMatch accepts a Block pointer (Swiss match, not a KO match)', () => {
  const event = eventWithBlockARunning();
  const match = event.blockA.tournament.rounds[1].find((m) => !m.bye);
  let state = createCanalettoLiveState();
  state = selectTvMatch(state, { source: 'block', block: 'A', roundNumber: 1, matchId: match.id });
  assert.deepEqual(state.tvMatch, { source: 'block', block: 'A', roundNumber: 1, matchId: match.id });
  assert.deepEqual(getCurrentTvScore(state), { r1: 0, r2: 0 });
});

test('selectTvMatch rejects an invalid block letter', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => selectTvMatch(state, { source: 'block', block: 'C', roundNumber: 1, matchId: 1 }), /block/);
});

test('selectTvMatch rejects a missing matchId for a Block pointer', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => selectTvMatch(state, { source: 'block', block: 'A', roundNumber: 1 }), /matchId/);
});

// ---------------------------------------------------------------------------
// clearTvMatch
// ---------------------------------------------------------------------------

test('clearTvMatch resets the pointer but preserves any already-stored per-match scores', () => {
  let state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'final', matchNumber: 1 });
  state = setTvScore(state, { r1: 4, r2: 1 });
  const cleared = clearTvMatch(state);
  assert.equal(cleared.tvMatch, null);
  assert.deepEqual(getCurrentTvScore(cleared), { r1: 0, r2: 0 }); // nothing selected -> reads as 0-0
  assert.deepEqual(cleared.tvScores['ko:final:1'], { r1: 4, r2: 1 }); // but the stored score itself survives
});

// ---------------------------------------------------------------------------
// tvMatchKey / getCurrentTvScore / setTvScore — PER-MATCH broadcast scores
// (streaming-staff correction pass item 5: switching cameras must not blow
// away a score already dialled in for the match being switched back to).
// ---------------------------------------------------------------------------

test('tvMatchKey produces distinct, stable keys for different pointers', () => {
  assert.equal(tvMatchKey({ source: 'ko', stage: 'top16', matchNumber: 3 }), 'ko:top16:3');
  assert.equal(tvMatchKey({ source: 'block', block: 'A', roundNumber: 2, matchId: 7 }), 'block:A:2:7');
  assert.notEqual(
    tvMatchKey({ source: 'ko', stage: 'top16', matchNumber: 1 }),
    tvMatchKey({ source: 'ko', stage: 'top16', matchNumber: 2 })
  );
  assert.equal(tvMatchKey(null), null);
});

test('setTvScore updates the score when a TV match is selected', () => {
  let state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'semifinals', matchNumber: 2 });
  state = setTvScore(state, { r1: 6, r2: 3 });
  assert.deepEqual(getCurrentTvScore(state), { r1: 6, r2: 3 });
});

test('setTvScore throws when no TV match is selected', () => {
  const state = createCanalettoLiveState();
  assert.throws(() => setTvScore(state, { r1: 1, r2: 0 }), /no TV match/);
});

test('setTvScore rejects negative or non-integer scores', () => {
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: 1 });
  assert.throws(() => setTvScore(state, { r1: -1, r2: 0 }), /r1/);
  assert.throws(() => setTvScore(state, { r1: 1.5, r2: 0 }), /r1/);
  assert.throws(() => setTvScore(state, { r1: 0, r2: -1 }), /r2/);
  assert.throws(() => setTvScore(state, { r1: 0, r2: 2.2 }), /r2/);
});

test('setTvScore is not bounded by a race target — it is a manual display aid, not authoritative', () => {
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: 1 });
  const next = setTvScore(state, { r1: 99, r2: 99 });
  assert.deepEqual(getCurrentTvScore(next), { r1: 99, r2: 99 });
});

test('per-match stream scores survive switching away and back: select A, score A, switch to B, score B, switch back to A restores A', () => {
  let state = createCanalettoLiveState();
  state = selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 1 });
  state = setTvScore(state, { r1: 4, r2: 2 });

  state = selectTvMatch(state, { source: 'block', block: 'A', roundNumber: 1, matchId: 55 });
  assert.deepEqual(getCurrentTvScore(state), { r1: 0, r2: 0 }); // fresh match, no score yet
  state = setTvScore(state, { r1: 7, r2: 1 });

  state = selectTvMatch(state, { source: 'ko', stage: 'top16', matchNumber: 1 });
  assert.deepEqual(getCurrentTvScore(state), { r1: 4, r2: 2 }); // Match A's score restored exactly

  state = selectTvMatch(state, { source: 'block', block: 'A', roundNumber: 1, matchId: 55 });
  assert.deepEqual(getCurrentTvScore(state), { r1: 7, r2: 1 }); // Match B's score also survived
});

// ---------------------------------------------------------------------------
// validateCanalettoLiveState
// ---------------------------------------------------------------------------

test('validateCanalettoLiveState rejects non-object input', () => {
  assert.equal(validateCanalettoLiveState(null).valid, false);
  assert.equal(validateCanalettoLiveState([]).valid, false);
  assert.equal(validateCanalettoLiveState('nope').valid, false);
});

test('validateCanalettoLiveState rejects a malformed tvMatch or tvScores', () => {
  const badStage = { tvMatch: { source: 'ko', stage: 'nope', matchNumber: 1 }, tvScores: {} };
  assert.equal(validateCanalettoLiveState(badStage).valid, false);

  const badBlock = { tvMatch: { source: 'block', block: 'C', roundNumber: 1, matchId: 1 }, tvScores: {} };
  assert.equal(validateCanalettoLiveState(badBlock).valid, false);

  const badScoresShape = { tvMatch: null, tvScores: [] };
  assert.equal(validateCanalettoLiveState(badScoresShape).valid, false);

  const badScoreEntry = { tvMatch: null, tvScores: { 'ko:top16:1': { r1: -1, r2: 0 } } };
  assert.equal(validateCanalettoLiveState(badScoreEntry).valid, false);
});

test('validateCanalettoLiveState accepts a valid Block pointer and multiple stored per-match scores', () => {
  const state = {
    tvMatch: { source: 'block', block: 'B', roundNumber: 2, matchId: 12345 },
    tvScores: { 'block:B:2:12345': { r1: 3, r2: 2 }, 'ko:top16:1': { r1: 0, r2: 0 } }
  };
  assert.equal(validateCanalettoLiveState(state).valid, true);
});

// ---------------------------------------------------------------------------
// resolveTvMatch — normalized shape, KO source
// ---------------------------------------------------------------------------

test('resolveTvMatch returns null when no TV match is selected', () => {
  const event = eventWithTop16Started();
  assert.equal(resolveTvMatch(event, createCanalettoLiveState()), null);
});

test('resolveTvMatch reads the real KO match fresh from the event by stage+matchNumber', () => {
  const event = eventWithTop16Started();
  const match = event.ko.top16.matches[2];
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: match.matchNumber });
  const resolved = resolveTvMatch(event, state);
  assert.equal(resolved.source, 'ko');
  assert.equal(resolved.tbl, match.tbl);
  assert.equal(resolved.p1.name, match.p1.name);
  assert.equal(resolved.p2.name, match.p2.name);
  assert.equal(resolved.p1.gbr, match.p1.gbr);
  assert.equal(resolved.p2.gbr, match.p2.gbr);
});

test('resolveTvMatch returns null when the pointer references a KO stage that has not started yet', () => {
  const event = eventWithTop16Started();
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'quarterfinals', matchNumber: 1 });
  assert.equal(resolveTvMatch(event, state), null);
});

test('resolveTvMatch returns null when the pointer references a matchNumber that does not exist in the stage', () => {
  const event = eventWithTop16Started();
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: 999 });
  assert.equal(resolveTvMatch(event, state), null);
});

test('resolveTvMatch never exposes a score field — the broadcast score is separate from the resolved official match', () => {
  const event = eventWithTop16Started();
  const match = event.ko.top16.matches[0];
  const state = setTvScore(
    selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: match.matchNumber }),
    { r1: 3, r2: 1 }
  );
  const resolved = resolveTvMatch(event, state);
  assert.equal(resolved.p1.name, match.p1.name);
  assert.equal('r1' in resolved, false);
  assert.equal('r2' in resolved, false);
  assert.deepEqual(getCurrentTvScore(state), { r1: 3, r2: 1 });
});

// ---------------------------------------------------------------------------
// resolveTvMatch — normalized shape, Block source (director correction pass:
// the ticker must work for Block A/B Swiss matches too)
// ---------------------------------------------------------------------------

test('resolveTvMatch resolves a Block A Swiss match with the same normalized shape as a KO match', () => {
  const event = eventWithBlockARunning();
  const match = event.blockA.tournament.rounds[1].find((m) => !m.bye);
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'block', block: 'A', roundNumber: 1, matchId: match.id });
  const resolved = resolveTvMatch(event, state);
  assert.equal(resolved.source, 'block');
  assert.equal(resolved.tbl, match.tbl);
  assert.equal(resolved.p1.name, match.p1.name);
  assert.equal(resolved.p2.name, match.p2.name);
  assert.equal(resolved.p1.gbr, match.p1.elo);
  assert.equal(resolved.p2.gbr, match.p2.elo);
  assert.equal(resolved.target, event.blockA.tournament.config.max_games);
});

test('resolveTvMatch returns null for a Block pointer whose match no longer resolves (e.g. wrong matchId)', () => {
  const event = eventWithBlockARunning();
  const state = selectTvMatch(createCanalettoLiveState(), { source: 'block', block: 'A', roundNumber: 1, matchId: -1 });
  assert.equal(resolveTvMatch(event, state), null);
});

test('resolveTvMatch normalizes Block and KO matches to the exact same field set (p1/p2 symmetry for the ticker)', () => {
  const blockEvent = eventWithBlockARunning();
  const blockMatch = blockEvent.blockA.tournament.rounds[1].find((m) => !m.bye);
  const blockResolved = resolveTvMatch(blockEvent, selectTvMatch(createCanalettoLiveState(), { source: 'block', block: 'A', roundNumber: 1, matchId: blockMatch.id }));

  const koEvent = eventWithTop16Started();
  const koMatch = koEvent.ko.top16.matches[0];
  const koResolved = resolveTvMatch(koEvent, selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: koMatch.matchNumber }));

  const keysOf = (o) => Object.keys(o).sort();
  assert.deepEqual(keysOf(blockResolved), keysOf(koResolved));
  assert.deepEqual(keysOf(blockResolved.p1), keysOf(koResolved.p1));
  assert.deepEqual(keysOf(blockResolved.p2), keysOf(koResolved.p2));
  assert.deepEqual(keysOf(blockResolved.p1), keysOf(blockResolved.p2));
});

// ---------------------------------------------------------------------------
// getTvSelectableMatches / isSelectedTvRow — director correction pass item
// 15/19: the LIVE control page must be able to list/select current matches
// from Block A/B's current round AND every generated KO stage.
// ---------------------------------------------------------------------------

test('getTvSelectableMatches lists Block A current-round matches when only Block A is running', () => {
  const event = eventWithBlockARunning();
  const rows = getTvSelectableMatches(event);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.source === 'block' && r.block === 'A' && r.roundNumber === 1));
});

test('getTvSelectableMatches lists every generated KO stage (Top16/QF/SF/Final) once each stage exists', () => {
  const event = eventWithTop16Started();
  const rows = getTvSelectableMatches(event);
  const koRows = rows.filter((r) => r.source === 'ko');
  assert.ok(koRows.some((r) => r.stage === 'top16'));
  assert.ok(koRows.every((r) => ['top16', 'quarterfinals', 'semifinals', 'final'].includes(r.stage)));
});

test('getTvSelectableMatches excludes a locked block\'s matches (no longer current/operational)', () => {
  const event = eventWithTop16Started(); // both blocks locked, top16 started
  const rows = getTvSelectableMatches(event);
  assert.ok(rows.every((r) => r.source !== 'block'));
});

test('getTvSelectableMatches flags the match on table "301 TV" via isPreferredTable, without excluding every other match', () => {
  const event = eventWithBlockARunning();
  const rows = getTvSelectableMatches(event);
  const preferred = rows.filter((r) => r.isPreferredTable);
  const others = rows.filter((r) => !r.isPreferredTable);
  assert.ok(preferred.every((r) => r.tbl === PREFERRED_TV_TABLE_LABEL));
  // Selection is never restricted to the preferred table — every row (not
  // just the flagged one) is still a legitimate selectTvMatch() target.
  assert.ok(others.length > 0);
  others.forEach((r) => {
    const selected = selectTvMatch(createCanalettoLiveState(), r);
    assert.ok(selected.tvMatch);
  });
});

test('isSelectedTvRow matches a Block row and a KO row by their own identity fields, never cross-matching', () => {
  const blockPointer = { source: 'block', block: 'A', roundNumber: 1, matchId: 42 };
  const koPointer = { source: 'ko', stage: 'top16', matchNumber: 1 };
  const blockRow = { source: 'block', block: 'A', roundNumber: 1, matchId: 42 };
  const koRow = { source: 'ko', stage: 'top16', matchNumber: 1 };

  assert.equal(isSelectedTvRow(blockPointer, blockRow), true);
  assert.equal(isSelectedTvRow(koPointer, koRow), true);
  assert.equal(isSelectedTvRow(blockPointer, koRow), false);
  assert.equal(isSelectedTvRow(koPointer, blockRow), false);
  assert.equal(isSelectedTvRow(null, blockRow), false);
});

// ---------------------------------------------------------------------------
// Streaming-staff TV selection — director's LIVE page and the streaming
// staff's TV Overlay Score Control page must read/write the SAME
// authoritative `tvMatch` field (item 1/7), staff must be able to pick a
// Block A, Block B, or KO match (item 2/4), switching must never touch the
// official event (item 4), and the ticker must reflect whichever match was
// selected last regardless of who selected it (item 4).
// ---------------------------------------------------------------------------

test('director and streaming staff read/write the exact same tvMatch field — whichever selects last wins', () => {
  const event = eventWithTop16Started();
  let liveState = createCanalettoLiveState();

  // "Director" picks a Top16 match.
  liveState = selectTvMatch(liveState, { source: 'ko', stage: 'top16', matchNumber: event.ko.top16.matches[0].matchNumber });
  assert.equal(resolveTvMatch(event, liveState).p1.name, event.ko.top16.matches[0].p1.name);

  // "Streaming staff", working from the SAME liveState object/field, switches to a different current KO match.
  const otherMatch = event.ko.top16.matches[1];
  liveState = selectTvMatch(liveState, { source: 'ko', stage: 'top16', matchNumber: otherMatch.matchNumber });

  // The ticker (resolveTvMatch) now reflects staff's choice — one shared pointer, not two independent selections.
  const resolved = resolveTvMatch(event, liveState);
  assert.equal(resolved.p1.name, otherMatch.p1.name);
  assert.equal(resolved.p2.name, otherMatch.p2.name);
});

test('streaming staff can select a Block A current-round match', () => {
  const event = eventWithBlockARunning();
  const rows = getTvSelectableMatches(event).filter((r) => r.source === 'block' && r.block === 'A');
  assert.ok(rows.length > 0);
  const staffState = selectTvMatch(createCanalettoLiveState(), rows[0]);
  const resolved = resolveTvMatch(event, staffState);
  assert.equal(resolved.source, 'block');
  assert.equal(resolved.p1.name, rows[0].p1Name);
});

test('streaming staff can select a Block B current-round match', () => {
  let event = createCanalettoEvent({ roundsPerBlock: 2, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
  rosterOf(8, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'B');

  const rows = getTvSelectableMatches(event).filter((r) => r.source === 'block' && r.block === 'B');
  assert.ok(rows.length > 0);
  const staffState = selectTvMatch(createCanalettoLiveState(), rows[0]);
  const resolved = resolveTvMatch(event, staffState);
  assert.equal(resolved.source, 'block');
  assert.equal(resolved.p1.name, rows[0].p1Name);
});

test('streaming staff can select a KO match', () => {
  const event = eventWithTop16Started();
  const rows = getTvSelectableMatches(event).filter((r) => r.source === 'ko');
  assert.ok(rows.length > 0);
  const staffState = selectTvMatch(createCanalettoLiveState(), rows[0]);
  const resolved = resolveTvMatch(event, staffState);
  assert.equal(resolved.source, 'ko');
  assert.equal(resolved.p1.name, rows[0].p1Name);
});

test('switching the TV match never changes the official table assignment', () => {
  const event = eventWithBlockARunning();
  const matches = event.blockA.tournament.rounds[1].filter((m) => !m.bye);
  const tablesBefore = matches.map((m) => m.tbl);

  let liveState = createCanalettoLiveState();
  matches.forEach((m) => {
    liveState = selectTvMatch(liveState, { source: 'block', block: 'A', roundNumber: 1, matchId: m.id });
  });

  const tablesAfter = event.blockA.tournament.rounds[1].filter((m) => !m.bye).map((m) => m.tbl);
  assert.deepEqual(tablesAfter, tablesBefore);
});

test('switching the TV match never changes the official result', () => {
  const event = eventWithTop16Started();
  const before = JSON.parse(JSON.stringify(event.ko.top16.matches));

  let liveState = createCanalettoLiveState();
  event.ko.top16.matches.forEach((m) => {
    liveState = selectTvMatch(liveState, { source: 'ko', stage: 'top16', matchNumber: m.matchNumber });
    liveState = setTvScore(liveState, { r1: 9, r2: 9 }); // deliberately nonsensical broadcast score
  });

  assert.deepEqual(event.ko.top16.matches, before);
});

test('the ticker (resolveTvMatch) follows the newly selected match immediately, for both Block and KO sources', () => {
  const event = eventWithTop16Started();
  let liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: event.ko.top16.matches[0].matchNumber });
  assert.equal(resolveTvMatch(event, liveState).source, 'ko');

  const blockEvent = eventWithBlockARunning();
  const blockMatch = blockEvent.blockA.tournament.rounds[1].find((m) => !m.bye);
  liveState = selectTvMatch(liveState, { source: 'block', block: 'A', roundNumber: 1, matchId: blockMatch.id });
  const resolved = resolveTvMatch(blockEvent, liveState);
  assert.equal(resolved.source, 'block');
  assert.equal(resolved.p1.name, blockMatch.p1.name);
});

// ---------------------------------------------------------------------------
// liveLinks.js — buildLiveUrl
// ---------------------------------------------------------------------------

test('buildLiveUrl joins origin, pathname, and query with exactly one "?"', () => {
  assert.equal(
    buildLiveUrl('http://localhost:5173', '/', 'live=livescore'),
    'http://localhost:5173/?live=livescore'
  );
});

test('LIVE_LINKS defines every documented public/overlay route with a stable key and query', () => {
  const keys = LIVE_LINKS.map((l) => l.key).sort();
  assert.deepEqual(keys, [
    'block-results-a',
    'block-results-b',
    'bracket',
    'livescore',
    'top12-a',
    'top12-b',
    'tv-control',
    'tv-overlay'
  ].sort());
  LIVE_LINKS.forEach((l) => {
    assert.equal(typeof l.label, 'string');
    assert.ok(l.query.startsWith('live='));
  });
});

// ---------------------------------------------------------------------------
// overlayShell.js — full Results/bracket overlays must render as a
// transparent-background OBS overlay, never an opaque full-canvas page
// (director correction pass items 5/6).
// ---------------------------------------------------------------------------

test('OVERLAY_SHELL_OUTER_CLASS keeps the outer page background transparent', () => {
  assert.ok(OVERLAY_SHELL_OUTER_CLASS.includes('bg-transparent'));
  assert.ok(!OVERLAY_SHELL_OUTER_CLASS.includes('bg-canaletto-bg'));
});

test('OVERLAY_PANEL_CLASS uses a semi-opaque (not solid) panel background', () => {
  assert.match(OVERLAY_PANEL_CLASS, /bg-canaletto-panel\/\d+/);
});

// ---------------------------------------------------------------------------
// Source-scan guard: the public/OBS-facing LIVE pages must never import a
// director-mutation command or a director-only editing component (director
// correction pass item 17 — "no director logic on public/OBS views"). This
// repo's test runner is plain `node --test` with no JSX/DOM rendering
// support, so this guard is a text-level check on the page source rather
// than a rendered-output assertion — still a real regression guard against
// a public page accidentally importing something it must not.
// ---------------------------------------------------------------------------

const FORBIDDEN_IN_PUBLIC_PAGES = [
  'addPlayerToBlock', 'addPendingPlayerToBlock', 'removePlayerFromBlock',
  'recordBlockMatchResult', 'recordKoResult', 'recordKoMatchResult',
  'assignBlockMatchTable', 'assignKoTable', 'advanceBlockRound',
  'confirmBlockRoundTables', 'editBlockRoundTables', 'confirmKoTables', 'editKoTables',
  'lockBlock', 'startBlock', 'startTop16', 'startNextKoStage',
  'markBlockPlayerMissing', 'undoBlockPlayerMissing',
  'resetBlockCurrentRound', 'DangerZone', 'ManualPairingModal', 'AddPlayerModal'
];

const PUBLIC_PAGE_FILES = [
  'LivescorePage.jsx',
  'Top12OverlayPage.jsx',
  'BlockResultsOverlayPage.jsx',
  'BracketOverlayPage.jsx',
  'TvOverlayPage.jsx'
];

test('public/OBS LIVE pages never import a director-mutation command or director-only editor component', () => {
  PUBLIC_PAGE_FILES.forEach((file) => {
    const source = readFileSync(path.join(__dirname, '../src/canaletto/live', file), 'utf8');
    FORBIDDEN_IN_PUBLIC_PAGES.forEach((name) => {
      assert.ok(!source.includes(name), `${file} must not reference "${name}"`);
    });
  });
});

test('TvScoreControlPage only ever writes setTvScore/canalettoLive.js state, never an official-result command', () => {
  const source = readFileSync(path.join(__dirname, '../src/canaletto/live/TvScoreControlPage.jsx'), 'utf8');
  FORBIDDEN_IN_PUBLIC_PAGES.forEach((name) => {
    assert.ok(!source.includes(name), `TvScoreControlPage.jsx must not reference "${name}"`);
  });
  assert.ok(source.includes('setTvScore'));
});
