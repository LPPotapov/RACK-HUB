import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TOP16_SEED_ORDER,
  addPlayerToBlock,
  assignKoTable,
  confirmKoTables,
  createCanalettoEvent,
  getBlockStatus,
  getKoGbrWeight,
  getTop16SeedOrder,
  getTop16Status,
  lockBlock,
  recordBlockMatchResult,
  recordKoResult,
  setEventTables,
  startBlock,
  startTop16,
  updateKoGbrWeight,
  updateTop16SeedOrder,
  validateCanalettoEvent
} from '../src/application/canalettoEvent.js';
import { createCanalettoLiveState, getTvSelectableMatches, resolveTvMatch, selectTvMatch } from '../src/application/canalettoLive.js';
import { derivePublicState, validatePublicState } from '../src/application/canalettoPublicState.js';
import {
  decodeEventFromCloud,
  decodePublicStateFromCloud,
  encodeEventForCloud,
  encodePublicStateForCloud
} from '../src/firebase/canalettoCloudCodec.js';

// ---------------------------------------------------------------------------
// simulateRtdb() — a test double reproducing the TWO Realtime Database
// representational behaviors empirically confirmed against the real
// production database during the event-blocking cloud sync investigation
// (`firebase database:get`, read-only):
//   1. `null`/`undefined` values and empty arrays/objects are not stored at
//      all — the key is simply absent on read (confirmed: `tables` and
//      `blockA.tournament.pendingPlayers` both came back `null`).
//   2. A plain object whose keys are ALL non-negative-integer strings is
//      silently reinterpreted as a sparse JS array, null-padding any
//      missing index below the highest key (confirmed: `rounds` — with
//      only key "1" — came back as `[null, [...]]`, not `{"1": [...]}`).
// This is not a claim of exact RTDB internals for every possible shape —
// it is a direct model of the specific corruption observed in production,
// used to prove the codec fixes it.
// ---------------------------------------------------------------------------
const isPlainObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const simulateRtdb = (value) => {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const mapped = value.map(simulateRtdb).filter((v) => v !== undefined);
    return mapped.length ? mapped : undefined;
  }
  if (isPlainObj(value)) {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, simulateRtdb(v)])
      .filter(([, v]) => v !== undefined);
    if (entries.length === 0) return undefined;
    const allNumericKeys = entries.every(([k]) => /^\d+$/.test(k));
    if (allNumericKeys) {
      const maxIndex = Math.max(...entries.map(([k]) => Number(k)));
      const arr = new Array(maxIndex + 1).fill(null);
      entries.forEach(([k, v]) => { arr[Number(k)] = v; });
      return arr;
    }
    return Object.fromEntries(entries);
  }
  return value;
};

const rosterOf = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `Player ${offset + i + 1}`, elo: 1500 + (n - i) }));
const tablesOf = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, label: `Table ${i + 1}` }));

const richEvent = () => {
  let event = createCanalettoEvent({ roundsPerBlock: 1, racksPerMatch: 8, qualificationThreshold: 8 });
  event = setEventTables(event, tablesOf(3));
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
  event = startTop16(event);
  event = updateKoGbrWeight(event, 0.75);
  const firstMatch = event.ko.top16.matches[0];
  event = assignKoTable(event, 'top16', { matchNumber: firstMatch.matchNumber, table: 'Table 1' });
  event = confirmKoTables(event, 'top16');
  event = recordKoResult(event, 'top16', { matchNumber: firstMatch.matchNumber, r1: 7, r2: 2 });
  return event;
};

const cloudRoundTrip = (event) => decodeEventFromCloud(simulateRtdb(encodeEventForCloud(event)));
const publicCloudRoundTrip = (publicState) => decodePublicStateFromCloud(simulateRtdb(encodePublicStateForCloud(publicState)));

// ---------------------------------------------------------------------------
// Root-cause regression: a full valid CanalettoEvent must survive the
// Firebase round trip and STILL validate — this reproduces and fixes the
// exact "tables must be an array; blockA.tournament.pendingPlayers must be
// an array; ...blockA.tournament.rounds must be a plain object keyed by
// round number" failure observed against production data.
// ---------------------------------------------------------------------------

test('a full valid CanalettoEvent can be written to privateState and read back validating successfully', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  const result = validateCanalettoEvent(roundTripped);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('WITHOUT the codec, the same round trip reproduces the exact reported corruption (proves the codec is necessary, not just nice-to-have)', () => {
  const event = richEvent();
  const naive = simulateRtdb(event); // no encode/decode at all
  const result = validateCanalettoEvent(naive);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('rounds must be a plain object')));
});

test('a custom Top16 seed order survives the Firebase encode/decode round trip exactly', () => {
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

  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(roundTripped.top16SeedOrder, customOrder);
  assert.equal(validateCanalettoEvent(roundTripped).valid, true);

  const publicState = derivePublicState(event, null);
  const publicRoundTripped = publicCloudRoundTrip(publicState);
  assert.deepEqual(publicRoundTripped.top16SeedOrder, customOrder);
});

test('rounds keyed by round number survive the round trip with correct keys and content', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(Object.keys(roundTripped.blockA.tournament.rounds), ['1']);
  const original = event.blockA.tournament.rounds[1];
  const decoded = roundTripped.blockA.tournament.rounds[1];
  assert.equal(decoded.length, original.length);
  // Structurally important fields survive exactly; a genuinely-empty
  // nested array field like a player snapshot's `opps: []` legitimately
  // does NOT survive a real RTDB round trip (RTDB drops empty arrays at
  // every depth, not just the specific fields this codec defaults) — that
  // is expected, not a regression, so this deliberately does not assert
  // full deep-equality of the whole match object.
  original.forEach((match, i) => {
    assert.equal(decoded[i].id, match.id);
    assert.equal(decoded[i].r1, match.r1);
    assert.equal(decoded[i].r2, match.r2);
    assert.equal(decoded[i].p1.name, match.p1.name);
    assert.equal(decoded[i].p2.name, match.p2.name);
    assert.equal(decoded[i].tbl, match.tbl);
  });
});

test('an empty tables/pendingPlayers array (dropped entirely by RTDB) decodes back to [] rather than staying absent', () => {
  const event = createCanalettoEvent(); // tables: [], both blocks' pendingPlayers: []
  assert.deepEqual(event.tables, []);
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(roundTripped.tables, []);
  assert.deepEqual(roundTripped.blockA.tournament.pendingPlayers, []);
  assert.equal(validateCanalettoEvent(roundTripped).valid, true);
});

test('decodeEventFromCloud also repairs data ALREADY corrupted in the database today (pre-fix legacy writes), not just future writes', () => {
  // Hand-built to mirror exactly what `firebase database:get` returned in
  // production: rounds already reinterpreted as a sparse array, unrelated
  // to whether this specific payload ever passed through encodeEventForCloud.
  const legacyCorrupted = {
    schemaVersion: 1,
    settings: { title: 'T' },
    schedule: {},
    koGbrWeight: 0.5,
    blockA: {
      tournament: {
        schemaVersion: 1,
        started: true,
        currentRound: 1,
        totalRounds: 1,
        config: {},
        tournamentConfig: {},
        roster: [{ id: 1, name: 'A', elo: 1500 }],
        players: [{ id: 1, name: 'A', elo: 1500, mp: 0 }],
        rounds: [null, [{ id: 1, done: false, cancelled: false, bye: false, p1: { id: 1 }, p2: { id: 2 } }]]
      }
    },
    blockB: {
      tournament: {
        schemaVersion: 1,
        started: false,
        currentRound: 0,
        totalRounds: 1,
        config: {},
        tournamentConfig: {},
        roster: [],
        players: [],
        rounds: []
      }
    }
    // tables/blockALock/blockBLock/ko/blockATableConfirmations/
    // blockBTableConfirmations all absent, exactly like production.
  };
  const decoded = decodeEventFromCloud(legacyCorrupted);
  assert.deepEqual(Object.keys(decoded.blockA.tournament.rounds), ['1']);
  assert.deepEqual(decoded.tables, []);
  assert.deepEqual(decoded.blockB.tournament.rounds, {});
  const result = validateCanalettoEvent(decoded);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('Top16 seed hotfix: an existing event with no top16SeedOrder field at all decodes cleanly and resolves to the new default preset (no crash, no migration required)', () => {
  const decoded = decodeEventFromCloud({
    schemaVersion: 1,
    settings: { title: 'T' },
    schedule: {},
    koGbrWeight: 0.5,
    blockA: { tournament: { started: false, currentRound: 0, totalRounds: 1, config: {}, tournamentConfig: {}, roster: [], players: [], rounds: [] } },
    blockB: { tournament: { started: false, currentRound: 0, totalRounds: 1, config: {}, tournamentConfig: {}, roster: [], players: [], rounds: [] } }
    // No top16SeedOrder field at all — pre-hotfix event.
  });
  assert.equal('top16SeedOrder' in decoded, false);
  assert.equal(validateCanalettoEvent(decoded).valid, true);
  assert.deepEqual(getTop16SeedOrder(decoded), DEFAULT_TOP16_SEED_ORDER);
});

test('koGbrWeight and other real values are unaffected by the round trip', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.equal(getKoGbrWeight(roundTripped), 0.75);
});

// ---------------------------------------------------------------------------
// publicState: reduced projection must ALSO survive the round trip, and a
// full private event must never be substitutable for it or vice versa.
// ---------------------------------------------------------------------------

test('a reduced publicState survives the cloud round trip and remains valid per its OWN lightweight schema', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const roundTripped = publicCloudRoundTrip(publicState);
  const result = validatePublicState(roundTripped);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('a reduced publicState, even after surviving the round trip, still fails the FULL-event validator (it must never be written to privateState)', () => {
  const event = richEvent();
  const publicState = derivePublicState(event, null);
  const roundTripped = publicCloudRoundTrip(publicState);
  assert.equal(validateCanalettoEvent(roundTripped).valid, false);
});

test('table labels survive the full cloud round trip, both at the event level and on individual matches', () => {
  const event = richEvent();
  const roundTripped = cloudRoundTrip(event);
  assert.deepEqual(roundTripped.tables, event.tables);
  const koMatch = roundTripped.ko.top16.matches.find((m) => m.tbl);
  assert.equal(koMatch.tbl, 'Table 1');
});

test('a started block produces a correct Stream Staff match catalog after the full publicState cloud round trip', () => {
  const event = richEvent();
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  const rows = getTvSelectableMatches(publicState);
  assert.ok(rows.some((r) => r.source === 'ko'));
  const koRow = rows.find((r) => r.source === 'ko');
  assert.ok(koRow.p1Name);
  assert.ok(koRow.p2Name);
  assert.equal(koRow.tbl, 'Table 1');
});

test('a TV-selected match resolves correctly from a round-tripped publicState', () => {
  const event = richEvent();
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  const targetMatchNumber = event.ko.top16.matches[1].matchNumber;
  const liveState = selectTvMatch(createCanalettoLiveState(), { source: 'ko', stage: 'top16', matchNumber: targetMatchNumber });
  const resolved = resolveTvMatch(publicState, liveState);
  assert.equal(resolved.p1.name, event.ko.top16.matches[1].p1.name);
  assert.equal(resolved.p2.name, event.ko.top16.matches[1].p2.name);
});

test('per-match manual stream score stays independent of official score across the whole pipeline (live is never part of privateState/publicState)', () => {
  const event = richEvent();
  const koMatch = event.ko.top16.matches[0]; // has an OFFICIAL result: 7-2
  const publicState = publicCloudRoundTrip(derivePublicState(event, null));
  assert.equal('tvScores' in publicState, false);
  assert.equal('tvMatch' in publicState, false);
  // Official result is completely unaffected by any of this.
  const roundTrippedPrivate = cloudRoundTrip(event);
  const roundTrippedMatch = roundTrippedPrivate.ko.top16.matches.find((m) => m.matchNumber === koMatch.matchNumber);
  assert.equal(roundTrippedMatch.r1, 7);
  assert.equal(roundTrippedMatch.r2, 2);
});

// ---------------------------------------------------------------------------
// Fresh-empty-tournament hotfix regression suite (item 11, A-I). Items B, C,
// F are genuinely useCanalettoCloudMirror.js HOOK behaviors (no React
// testing harness exists in this repo — every other hook here is tested the
// same way, only via its pure dependencies) — verified by direct code
// inspection of that file's inbound/outbound effects, and exercised here
// through the exact pure preconditions those effects are built on.
// ---------------------------------------------------------------------------

// A) director app remains usable when privateState/publicState/live are all null.
test('(A) when the cloud is completely empty, the codec never fabricates an event, and the local/default event both stay fully functional', () => {
  assert.equal(decodeEventFromCloud(null), null);
  assert.equal(decodePublicStateFromCloud(null), null);
  // The director app's OWN local event (untouched by any of this) remains
  // completely normal and usable — e.g. every nav-status query the app
  // calls unconditionally on every render keeps working.
  const local = createCanalettoEvent();
  assert.equal(getTop16Status(local), 'WAITING_FOR_BOTH');
  assert.equal(getBlockStatus(local, 'A'), 'NOT_STARTED');
  assert.equal(validateCanalettoEvent(local).valid, true);
});

// B) empty cloud does not trigger restoreCanalettoEvent — useCanalettoCloudMirror.js's
// inbound listener returns immediately on a falsy remoteEvent, BEFORE any
// decode/validate/restore call; decodeEventFromCloud(null) itself, which
// that early return is keyed on, is the precondition proven here.
test('(B) decodeEventFromCloud(null) is exactly the falsy signal the inbound listener early-returns on before ever calling restoreCanalettoEvent', () => {
  assert.equal(decodeEventFromCloud(null), null);
  assert.equal(!!decodeEventFromCloud(null), false);
});

// D) director can create/configure a new local tournament — entirely
// independent of cloud state by design (useCanalettoEvent.js is untouched
// by any of the cloud-sync work); this is exhaustively covered by the
// existing canaletto-event.test.js suite. Spot-checked here for this
// specific fresh-start scenario.
test('(D) a fresh local tournament can still be configured normally regardless of cloud state', () => {
  let event = createCanalettoEvent();
  event = setEventTables(event, [{ order: 1, label: 'Table 1' }]);
  event = addPlayerToBlock(event, 'A', { id: 1, name: 'Player 1', elo: 1500 });
  assert.equal(event.blockA.tournament.roster.length, 1);
  assert.equal(validateCanalettoEvent(event).valid, true);
});

// E) explicit first Publish validates + writes — the exact precondition
// publishToCloud() relies on: a valid local event encodes cleanly and is
// ready to write; an invalid one is caught before ever reaching
// writePrivateState().
test('(E) a valid local event passes validation and encodes cleanly, ready for an explicit first publish', () => {
  const event = richEvent();
  assert.equal(validateCanalettoEvent(event).valid, true);
  const encoded = encodeEventForCloud(event);
  assert.ok(encoded);
  assert.equal(validateCanalettoEvent(decodeEventFromCloud(encoded)).valid, true);
});

test('(E) an invalid local event is caught by validateCanalettoEvent BEFORE any write would occur', () => {
  const notAnEvent = { not: 'a real event' };
  assert.equal(validateCanalettoEvent(notAnEvent).valid, false);
});

// F) after first Publish, auto-sync becomes active — a hook-only state
// transition (useCanalettoCloudMirror.js's publishToCloud() sets
// syncMode: 'active' on success); verified by code review of that
// function. Not independently pure-testable without a component harness.

// G) Firebase read/write/decode failure does not crash the director UI —
// the codec itself must never throw for malformed/unexpected input (the
// hook wraps every callback in try/catch on top of this).
test('(G) decode functions never throw for malformed/garbage input, however unexpected', () => {
  const garbageInputs = [undefined, null, {}, [], 'a string', 42, true, { blockA: null }, { blockA: {} }, { blockA: { tournament: null } }];
  garbageInputs.forEach((input) => {
    assert.doesNotThrow(() => decodeEventFromCloud(input));
    assert.doesNotThrow(() => decodePublicStateFromCloud(input));
  });
});

test('(G) encode functions never throw for null/undefined (defensive — real callers only ever pass a validated event)', () => {
  assert.doesNotThrow(() => encodeEventForCloud(null));
  assert.doesNotThrow(() => encodeEventForCloud(undefined));
  assert.doesNotThrow(() => encodePublicStateForCloud(null));
  assert.equal(encodeEventForCloud(null), null);
  assert.equal(encodePublicStateForCloud(null), null);
});

// H) public/stream page with null cloud data renders a waiting state, not
// blank — useCloudPublicEvent.js falls back to derivePublicState(a fresh
// createCanalettoEvent(), null) before any snapshot arrives; that fallback
// value itself must never crash any consumer (getTvSelectableMatches,
// resolveTvMatch, getBracketProjection-adjacent reads all touch `ko`,
// which is exactly the field this hotfix was about).
test('(H) the empty-fallback publicState used before the first cloud snapshot arrives is itself completely safe to render', () => {
  const empty = derivePublicState(createCanalettoEvent(), null);
  assert.doesNotThrow(() => getTvSelectableMatches(empty));
  assert.deepEqual(getTvSelectableMatches(empty), []);
  assert.doesNotThrow(() => resolveTvMatch(empty, createCanalettoLiveState()));
  assert.equal(resolveTvMatch(empty, createCanalettoLiveState()), null);
  assert.equal(validatePublicState(empty).valid, true);
});

// I) codec handles null safely.
test('(I) every codec function handles null/undefined without throwing or fabricating a tournament', () => {
  assert.equal(decodeEventFromCloud(null), null);
  assert.equal(decodeEventFromCloud(undefined), null);
  assert.equal(decodePublicStateFromCloud(null), null);
  assert.equal(decodePublicStateFromCloud(undefined), null);
  assert.equal(encodeEventForCloud(null), null);
  assert.equal(encodePublicStateForCloud(null), null);
});

// Root-cause-specific: partially-populated ko (e.g. Top16 started, others
// still null) must survive untouched — the decode default only fills in
// the FULLY-empty case, never overwrites real KO progress.
test('a partially-started ko bracket is preserved exactly, not reset to all-null by the decode default', () => {
  const event = richEvent(); // ko.top16 is real/populated; quarterfinals/semifinals/final are still null
  const roundTripped = cloudRoundTrip(event);
  assert.ok(roundTripped.ko.top16);
  assert.equal(roundTripped.ko.top16.matches.length, event.ko.top16.matches.length);
  assert.equal(roundTripped.ko.quarterfinals, null);
});
