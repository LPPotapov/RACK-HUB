import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPendingPlayerToBlock,
  addPlayerToBlock,
  assignKoTable,
  confirmKoTables,
  createCanalettoEvent,
  getBracketProjection,
  getKoGbrWeight,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startTop16,
  updateKoGbrWeight,
  updateTop16SeedOrder
} from '../src/application/canalettoEvent.js';
import {
  createCanalettoLiveState,
  getLiveDraftScore,
  getTvSelectableMatches,
  resolveTvMatch,
  selectTvMatch,
  setLiveDraftScore,
  setTvScore
} from '../src/application/canalettoLive.js';
import { restoreCanalettoEvent } from '../src/application/canalettoBackup.js';
import { CANALETTO_PUBLIC_STATE_VERSION, derivePublicState, validatePublicState } from '../src/application/canalettoPublicState.js';

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}`, billardPadId: `bp-${i + 1}`, scoreLink: `https://example.test/${i + 1}` }));

// Same rich-fixture shape as tests/canaletto-backup.test.js: both blocks
// played/locked, Top16 generated with one recorded/table-assigned result, a
// non-default KO GBR weight, plus a pending (not-yet-active) player —
// enough surface area to prove the projection whitelist is correct.
const richEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(12));
  rosterOf(16).forEach((p) => { event = addPlayerToBlock(event, 'A', p); });
  rosterOf(16, 100).forEach((p) => { event = addPlayerToBlock(event, 'B', p); });
  event = startBlock(event, 'A');
  event = startBlock(event, 'B');
  event = addPendingPlayerToBlock(event, 'A', { id: 9001, name: 'Late Joiner', elo: 1500 });
  ['A', 'B'].forEach((block) => {
    const key = `block${block}`;
    event[key].tournament.rounds[1].forEach((m) => {
      event = recordBlockMatchResult(event, block, { roundNumber: 1, matchId: m.id, r1: 5, r2: 3 });
    });
  });
  event = lockBlock(event, 'A');
  event = lockBlock(event, 'B');
  event = startTop16(event);
  event = updateKoGbrWeight(event, 0.75);
  const firstMatch = event.ko.top16.matches[0];
  event = assignKoTable(event, 'top16', { matchNumber: firstMatch.matchNumber, table: 'Table 1' });
  event = confirmKoTables(event, 'top16');
  event = recordKoResult(event, 'top16', { matchNumber: firstMatch.matchNumber, r1: 7, r2: 2 });
  return event;
};

test('derivePublicState includes the public-safe whitelist', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);

  assert.equal(publicState.publicStateVersion, CANALETTO_PUBLIC_STATE_VERSION);
  assert.equal(typeof publicState.updatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(publicState.updatedAt)));

  assert.deepEqual(publicState.settings, event.settings);
  assert.deepEqual(publicState.schedule, event.schedule);

  assert.deepEqual(publicState.blockA.tournament.roster, event.blockA.tournament.roster);
  assert.deepEqual(publicState.blockA.tournament.players, event.blockA.tournament.players);
  assert.deepEqual(publicState.blockA.tournament.rounds, event.blockA.tournament.rounds);
  assert.equal(publicState.blockA.tournament.currentRound, event.blockA.tournament.currentRound);
  assert.equal(publicState.blockA.tournament.totalRounds, event.blockA.tournament.totalRounds);
  assert.deepEqual(publicState.blockA.tournament.config, event.blockA.tournament.config);
  assert.equal(publicState.blockA.tournament.started, event.blockA.tournament.started);

  assert.deepEqual(publicState.blockALock, event.blockALock);
  assert.deepEqual(publicState.blockBLock, event.blockBLock);
  assert.ok(publicState.blockALock.qualifiers.length > 0);
  assert.deepEqual(publicState.blockATableConfirmations, event.blockATableConfirmations);
  assert.deepEqual(publicState.blockBTableConfirmations, event.blockBTableConfirmations);

  assert.deepEqual(publicState.ko, event.ko);
  assert.equal(publicState.koGbrWeight, event.koGbrWeight);
  assert.equal(getKoGbrWeight({ koGbrWeight: publicState.koGbrWeight }), 0.75);

  assert.deepEqual(publicState.top16SeedOrder, event.top16SeedOrder);
});

test('public projection (getBracketProjection) uses the director-configured Top16 seed order — one authoritative bracket, director and public agree', () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(4));
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

  const customOrder = [
    ['B1', 'A8'], ['A1', 'B8'], ['A2', 'B7'], ['B2', 'A7'],
    ['A3', 'B6'], ['B3', 'A6'], ['A4', 'B5'], ['B4', 'A5']
  ];
  event = updateTop16SeedOrder(event, customOrder);

  const directorProjection = getBracketProjection(event);
  const publicProjection = getBracketProjection(derivePublicState(event, null));

  assert.equal(directorProjection.top16[0].top.seed, 'B1');
  assert.equal(directorProjection.top16[0].bottom.seed, 'A8');
  assert.deepEqual(
    publicProjection.top16.map((m) => [m.top.seed, m.bottom.seed]),
    directorProjection.top16.map((m) => [m.top.seed, m.bottom.seed])
  );
});

test('derivePublicState strips pendingPlayers from both blocks', () => {
  const event = richEvent();
  assert.ok(event.blockA.tournament.pendingPlayers.length > 0); // sanity: the fixture actually has one
  const publicState = derivePublicState(event, null);
  assert.equal('pendingPlayers' in publicState.blockA.tournament, false);
  assert.equal('pendingPlayers' in publicState.blockB.tournament, false);
});

test('derivePublicState strips preAdvanceSnapshot from both blocks', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  assert.equal('preAdvanceSnapshot' in publicState.blockA, false);
  assert.equal('preAdvanceSnapshot' in publicState.blockB, false);
});

test('derivePublicState reduces tables to {order, label}, stripping billardPadId/scoreLink', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  assert.ok(publicState.tables.length > 0);
  publicState.tables.forEach((t, i) => {
    assert.deepEqual(Object.keys(t).sort(), ['label', 'order']);
    assert.equal(t.order, event.tables[i].order);
    assert.equal(t.label, event.tables[i].label);
  });
});

test('derivePublicState never exposes the manual broadcast/stream score, even when liveState is supplied', () => {
  const event = richEvent();
  let liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: event.ko.top16.matches[1].matchNumber });
  liveState = setTvScore(liveState, { r1: 4, r2: 1 });
  const publicState = derivePublicState(event, liveState);
  const json = JSON.stringify(publicState);
  assert.ok(!json.includes('tvScores'));
  assert.ok(!json.includes('tvMatch'));
});

// ---------------------------------------------------------------------------
// LIVE DRAFT SCORE in publicState (livescore hotfix) — the ONE liveState
// field that DOES cross into publicState, separate from tvScores/tvMatch
// above (which never do).
// ---------------------------------------------------------------------------

test('derivePublicState copies liveDraftScores (and ONLY that field) from liveState', () => {
  const event = richEvent();
  const firstMatch = event.ko.top16.matches.find((m) => !m.done);
  let liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: firstMatch.matchNumber });
  liveState = setTvScore(liveState, { r1: 9, r2: 9 }); // broadcast score — must NOT leak
  liveState = setLiveDraftScore(liveState, { source: 'ko', stage: 'top16', matchNumber: firstMatch.matchNumber }, { r1: 3, r2: 2 });

  const publicState = derivePublicState(event, liveState);
  assert.deepEqual(publicState.liveDraftScores, liveState.liveDraftScores);
  assert.equal(getLiveDraftScore(publicState, { source: 'ko', stage: 'top16', matchNumber: firstMatch.matchNumber }).r1, 3);
  const json = JSON.stringify(publicState);
  assert.ok(!json.includes('tvScores'));
  assert.ok(!json.includes('"tvMatch"'));
});

test('derivePublicState defaults liveDraftScores to {} when liveState is null/omitted', () => {
  const event = richEvent();
  assert.deepEqual(derivePublicState(event, null).liveDraftScores, {});
});

// Urgent live-draft-scoring bugfix pass, item 11 — the exact property
// useCanalettoCloudMirror.js's fast-path effect relies on: a draft score
// change must produce a DIFFERENT publicState payload even when `event`
// itself is the SAME, unmutated reference (a draft change never touches
// `event` at all — see canalettoLive.js). If derivePublicState's output
// only ever varied with `event`, the mirror's `[liveState, ...]`-keyed
// effect would be pointless — this proves the payload genuinely depends on
// `liveState` independent of `event`.
test('derivePublicState produces a DIFFERENT payload for the SAME event reference when only liveState changes (proves publicState is not gated on event changing)', () => {
  const event = richEvent();
  const unfinished = event.ko.top16.matches.find((m) => !m.done);
  const pointer = { source: 'ko', stage: 'top16', matchNumber: unfinished.matchNumber };

  const before = derivePublicState(event, createCanalettoLiveState());
  const liveStateWithDraft = setLiveDraftScore(createCanalettoLiveState(), pointer, { r1: 5, r2: 4 });
  const after = derivePublicState(event, liveStateWithDraft);

  assert.notDeepEqual(before.liveDraftScores, after.liveDraftScores);
  assert.equal(getLiveDraftScore(after, pointer).r1, 5);
  // Same event reference both times — the official match itself never changed.
  assert.deepEqual(before.ko.top16.matches, after.ko.top16.matches);
});

test('public bracket projection prefers the live draft for an unfinished Top16 match', () => {
  const event = richEvent();
  const unfinished = event.ko.top16.matches.find((m) => !m.done);
  let liveState = createCanalettoLiveState();
  liveState = setLiveDraftScore(liveState, { source: 'ko', stage: 'top16', matchNumber: unfinished.matchNumber }, { r1: 4, r2: 3 });
  const publicState = derivePublicState(event, liveState);

  const projection = getBracketProjection(publicState);
  const slot = projection.top16.find((s) => s.real && s.match.matchNumber === unfinished.matchNumber);
  assert.equal(slot.match.done, false);
  assert.equal(getLiveDraftScore(publicState, { source: 'ko', stage: 'top16', matchNumber: unfinished.matchNumber }).r1, 4);
  // The official match itself is untouched by the draft — still not done,
  // no winner — consumers (koUi.jsx's BracketNode) decide display
  // preference from `!match.done`, never from a second source of truth.
  assert.equal(slot.match.winnerPlayerId, null);
});

test('public projection always shows the OFFICIAL score for a completed match, even if a stale draft still exists', () => {
  const event = richEvent(); // firstMatch is already recorded/done in this fixture
  const doneMatch = event.ko.top16.matches.find((m) => m.done);
  let liveState = createCanalettoLiveState();
  // A stale/never-cleared draft with a DIFFERENT score than the official one.
  liveState = setLiveDraftScore(liveState, { source: 'ko', stage: 'top16', matchNumber: doneMatch.matchNumber }, { r1: 1, r2: 1 });
  const publicState = derivePublicState(event, liveState);

  const projection = getBracketProjection(publicState);
  const slot = projection.top16.find((s) => s.real && s.match.matchNumber === doneMatch.matchNumber);
  assert.equal(slot.match.done, true);
  assert.equal(slot.match.r1, doneMatch.r1);
  assert.equal(slot.match.r2, doneMatch.r2);
  // The stale draft is still technically present in the payload...
  assert.ok(getLiveDraftScore(publicState, { source: 'ko', stage: 'top16', matchNumber: doneMatch.matchNumber }));
  // ...but every real consumer (koUi.jsx's BracketNode/BracketPlayerRow)
  // only ever reads it while `!match.done` — the official r1/r2 above is
  // what is actually displayed once a match is done, never the draft.
});

test('derivePublicState does not mutate its input event or liveState', () => {
  const event = richEvent();
  const liveState = setTvScore(selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: 1 }), { r1: 2, r2: 2 });
  const frozenEvent = JSON.parse(JSON.stringify(event));
  const frozenLive = JSON.parse(JSON.stringify(liveState));
  derivePublicState(event, liveState);
  assert.deepEqual(event, frozenEvent);
  assert.deepEqual(liveState, frozenLive);
});

test('derivePublicState output is a fully detached JSON-safe clone (no shared references back into event)', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  publicState.blockA.tournament.roster[0].name = 'Mutated';
  assert.notEqual(event.blockA.tournament.roster[0].name, 'Mutated');
});

test('derivePublicState round-trips through JSON cleanly (no undefined values Firebase RTDB would reject)', () => {
  const event = createCanalettoEvent();
  const publicState = derivePublicState(event, null);
  const roundTripped = JSON.parse(JSON.stringify(publicState));
  assert.deepEqual(roundTripped, publicState);
  const detectUndefined = (value) => {
    if (Array.isArray(value)) return value.some(detectUndefined);
    if (value && typeof value === 'object') return Object.values(value).some((v) => v === undefined || detectUndefined(v));
    return false;
  };
  assert.equal(detectUndefined(publicState), false);
});

test('derivePublicState works for a freshly-created (not-yet-started) event', () => {
  const event = createCanalettoEvent();
  const publicState = derivePublicState(event, null);
  assert.deepEqual(publicState.blockA.tournament.roster, []);
  assert.equal(publicState.blockALock, null);
  assert.deepEqual(publicState.ko, { top16: null, quarterfinals: null, semifinals: null, final: null });
});

// ---------------------------------------------------------------------------
// Regression — urgent blocker: publicState was reported reaching
// restoreCanalettoEvent()/validateCanalettoEvent() (the FULL-event
// validator), which always rejects it since it intentionally lacks
// pendingPlayers/preAdvanceSnapshot. Direct source trace found no such call
// site in any public/OBS consumer (useCloudPublicEvent.js,
// TvScoreControlPage.jsx, and the other five live/ pages never import
// canalettoBackup.js) — these tests lock in the CORRECT contract: a public
// cloud consumer validates with validatePublicState() (the lightweight
// schema for this reduced shape) and NEVER with the full-event validator,
// while the full validator/restore command continue to correctly reject a
// reduced payload (proving why routing it through them would always fail).
// ---------------------------------------------------------------------------

test('a derived publicState is accepted by validatePublicState (the public cloud consumer\'s own schema)', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const result = validatePublicState(publicState);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('a derived publicState is REJECTED by the full-event restoreCanalettoEvent/validateCanalettoEvent (proving it must never be routed through them)', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  assert.throws(
    () => restoreCanalettoEvent(createCanalettoEvent(), publicState),
    /failed validation/
  );
});

test('the Stream Staff match catalog (getTvSelectableMatches) can be built directly from a derived publicState, with no full event required', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const rows = getTvSelectableMatches(publicState);
  assert.ok(rows.some((r) => r.source === 'ko'));
  const koRow = rows.find((r) => r.source === 'ko');
  assert.ok(koRow.p1Name);
  assert.ok(koRow.p2Name);
});

test('resolveTvMatch (used by both TvOverlayPage and TvScoreControlPage) works against a derived publicState', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const targetMatchNumber = event.ko.top16.matches[1].matchNumber;
  const liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: targetMatchNumber });
  const resolved = resolveTvMatch(publicState, liveState);
  assert.equal(resolved.source, 'ko');
  assert.equal(resolved.p1.name, event.ko.top16.matches[1].p1.name);
  assert.equal(resolved.p2.name, event.ko.top16.matches[1].p2.name);
});

test('validatePublicState rejects a malformed/incomplete payload cleanly', () => {
  assert.equal(validatePublicState(null).valid, false);
  assert.equal(validatePublicState('nope').valid, false);
  assert.equal(validatePublicState({}).valid, false);
  const badVersion = { ...derivePublicState(richEvent(), null), publicStateVersion: 999 };
  assert.equal(validatePublicState(badVersion).valid, false);
});

test('restoreCanalettoEvent continues to reject an incomplete/malformed full-event backup object (unrelated to this fix, still correct)', () => {
  assert.throws(
    () => restoreCanalettoEvent(createCanalettoEvent(), { not: 'a real event' }),
    /failed validation/
  );
});
