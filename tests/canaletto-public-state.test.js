import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPendingPlayerToBlock,
  addPlayerToBlock,
  assignKoTable,
  confirmKoTables,
  createCanalettoEvent,
  getKoGbrWeight,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startTop16,
  updateKoGbrWeight
} from '../src/application/canalettoEvent.js';
import { createCanalettoLiveState, selectTvMatch, setTvScore } from '../src/application/canalettoLive.js';
import { CANALETTO_PUBLIC_STATE_VERSION, derivePublicState } from '../src/application/canalettoPublicState.js';

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
