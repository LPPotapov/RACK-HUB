// Firebase Realtime Database round-trip codec (event-blocking cloud sync
// fix, extended for the fresh-empty-tournament hotfix). RTDB has TWO
// well-known representational quirks that silently corrupt a
// CanalettoEvent/derivePublicState() payload on round trip:
//
//   1. An object whose keys are ALL numeric strings (e.g.
//      `tournament.rounds = {"1": [...]}`, keyed by round number) is
//      silently reinterpreted as a sparse JS ARRAY on read, null-padding
//      missing indices. Fixed by re-keying rounds with a non-numeric
//      prefix ("r1", "r2", ...) for the wire format only; decodeRounds()
//      strips it back and also tolerates old array-shaped corruption
//      already sitting in the database. `preAdvanceSnapshot.allRounds` has
//      the identical shape and gets the same treatment.
//   2. RTDB does not store `null`, empty arrays, or empty objects AT ALL —
//      including an object whose children are ALL `null` (e.g. a fresh
//      event's `ko: {top16:null,quarterfinals:null,semifinals:null,
//      final:null}` — every child is null, so the whole `ko` object itself
//      has nothing left to store and vanishes entirely). Writing one is
//      equivalent to deleting that path; reading it back returns it
//      completely ABSENT, not `[]`/`{}`/`null`.
//
// ROOT CAUSE OF THE FRESH-TOURNAMENT WHITE SCREEN: quirk 2 above hit
// `ko`, `blockALock`, `blockBLock`, `blockATableConfirmations`,
// `blockBTableConfirmations` — all `null`/`[]` for ANY freshly-created
// event (see createCanalettoEvent()), so ALL FIVE vanish on the very first
// cloud round trip. `validateCanalettoEvent()` treats these five as
// optional-when-present (canalettoEvent.js's own comment: "an event saved
// before the KO engine existed won't have this field yet"), so decoded
// data missing them still VALIDATES successfully and gets applied via
// restoreCanalettoEvent() — but the rest of the app (Sidebar.jsx,
// EventPage.jsx, both calling getTop16Status(event) unconditionally on
// every render) assumes `event.ko` unconditionally EXISTS, exactly like
// every locally-created event always has it. `getTop16Status()` does
// `event.ko.top16` with no optional chaining — `event.ko` being `undefined`
// throws `TypeError: Cannot read properties of undefined (reading
// 'top16')`, uncaught during render, and — with no error boundary —
// React unmounts the entire tree: dashboard flashes once (the original
// LOCAL event, which still has `ko`), then the cloud echo replaces it with
// the `ko`-less version and the next render throws. Reproduced directly
// (see tests/canaletto-cloud-codec.test.js) by encoding a fresh
// createCanalettoEvent(), simulating RTDB's actual storage-dropping
// behavior, decoding it back, and confirming the result validates but is
// missing `ko` entirely.
//
// THE FIX: decode always reconstructs the SAME empty/default shape
// createCanalettoEvent() itself uses for every field RTDB can drop this
// way — never leaving a field silently absent just because
// validateCanalettoEvent() happens to tolerate its absence. This is the
// SAME kind of migration-shim reasoning useCanalettoEvent.js's own
// loadInitialEvent() already applies for old localStorage saves missing
// `ko`/`schedule` — same defaults, same reasoning, now also applied to the
// cloud round trip.
//
// NULL SAFETY: decodeEventFromCloud(null) / decodePublicStateFromCloud(null)
// return `null` — an empty cloud path (nothing ever published, or
// intentionally deleted) is NEVER turned into a fabricated/bootstrap
// event; that is the caller's (useCanalettoCloudMirror.js's) job to
// recognize as "cloud empty," never this codec's. encodeEventForCloud()/
// encodePublicStateForCloud() are only ever meant to receive a real,
// already-validated event — the caller's responsibility, per
// useCanalettoCloudMirror.js's "always validateCanalettoEvent() before
// encoding" rule — but also return `null` defensively for a null/undefined
// input rather than throwing on `Object.entries(undefined)`-style access.
//
// This is PURELY a wire-format concern for canalettoCloudSync.js — the
// local/authoritative CanalettoEvent shape (localStorage, every
// canalettoEvent.js function, derivePublicState()'s own output before it
// is handed to this codec) is completely unaffected. encode/decode are the
// ONLY two places that ever see the transformed shape, and decode always
// restores the exact local contract, defaults included.

import { KO_STAGE_ORDER } from '../application/canalettoKo.js';
import { SCHEDULE_KEYS } from '../application/canalettoEvent.js';

const emptyKo = () => Object.fromEntries(KO_STAGE_ORDER.map((stage) => [stage, null]));
const emptySchedule = () => Object.fromEntries(SCHEDULE_KEYS.map((key) => [key, { start: '', end: '' }]));

const ROUND_KEY_PREFIX = 'r';

const encodeRounds = (rounds) => {
  const encoded = {};
  Object.entries(rounds || {}).forEach(([roundNumber, matches]) => {
    encoded[`${ROUND_KEY_PREFIX}${roundNumber}`] = matches;
  });
  return encoded;
};

const decodeRounds = (rounds) => {
  const decoded = {};
  if (rounds == null) return decoded;
  if (Array.isArray(rounds)) {
    // Pre-fix corrupted data still sitting in the database: RTDB
    // reinterpreted the numeric-keyed object as a sparse array. The array
    // INDEX is the original round number (index 0 is always null padding,
    // since round numbers start at 1).
    rounds.forEach((matches, index) => {
      if (matches != null) decoded[String(index)] = matches;
    });
    return decoded;
  }
  Object.entries(rounds).forEach(([key, matches]) => {
    if (matches == null) return;
    decoded[key.startsWith(ROUND_KEY_PREFIX) ? key.slice(ROUND_KEY_PREFIX.length) : key] = matches;
  });
  return decoded;
};

const encodeTournament = (tournament) => ({
  ...tournament,
  rounds: encodeRounds(tournament.rounds)
});

const decodeTournament = (tournament) => {
  if (!tournament || typeof tournament !== 'object') return tournament;
  return {
    ...tournament,
    roster: tournament.roster || [],
    players: tournament.players || [],
    pendingPlayers: tournament.pendingPlayers || [],
    rounds: decodeRounds(tournament.rounds)
  };
};

const encodeBlock = (block) => ({
  ...block,
  tournament: encodeTournament(block.tournament),
  ...(block.preAdvanceSnapshot
    ? { preAdvanceSnapshot: { ...block.preAdvanceSnapshot, allRounds: encodeRounds(block.preAdvanceSnapshot.allRounds) } }
    : {})
});

const decodeBlock = (block) => {
  if (!block) return block;
  const decoded = { ...block, tournament: decodeTournament(block.tournament) };
  if (block.preAdvanceSnapshot) {
    decoded.preAdvanceSnapshot = { ...block.preAdvanceSnapshot, allRounds: decodeRounds(block.preAdvanceSnapshot.allRounds) };
  }
  return decoded;
};

// Reconstructs `ko` to the exact createCanalettoEvent() default shape
// whenever RTDB dropped it (a not-yet-started KO bracket is ALL-null
// children, which RTDB stores as nothing) — never leaves it `undefined`.
// A partially-populated `ko` (e.g. top16 started, others still null) is
// NOT dropped by RTDB (it has at least one real child) and is preserved
// exactly as-is; this only fills in the fully-empty case.
const decodeKo = (ko) => {
  if (ko == null) return emptyKo();
  return { ...emptyKo(), ...ko };
};

const decodeSchedule = (schedule) => (schedule == null ? emptySchedule() : { ...emptySchedule(), ...schedule });

export const encodeEventForCloud = (event) => {
  if (!event) return null;
  return {
    ...event,
    blockA: encodeBlock(event.blockA),
    blockB: encodeBlock(event.blockB)
  };
};

export const decodeEventFromCloud = (raw) => {
  if (!raw) return null;
  return {
    ...raw,
    tables: raw.tables || [],
    blockALock: raw.blockALock ?? null,
    blockBLock: raw.blockBLock ?? null,
    blockATableConfirmations: raw.blockATableConfirmations || [],
    blockBTableConfirmations: raw.blockBTableConfirmations || [],
    ko: decodeKo(raw.ko),
    schedule: decodeSchedule(raw.schedule),
    blockA: decodeBlock(raw.blockA),
    blockB: decodeBlock(raw.blockB)
  };
};

// publicState has no `preAdvanceSnapshot` (derivePublicState() never
// copies it) — otherwise identical treatment to the full event.
export const encodePublicStateForCloud = (publicState) => {
  if (!publicState) return null;
  return {
    ...publicState,
    blockA: { tournament: encodeTournament(publicState.blockA.tournament) },
    blockB: { tournament: encodeTournament(publicState.blockB.tournament) }
  };
};

export const decodePublicStateFromCloud = (raw) => {
  if (!raw) return null;
  return {
    ...raw,
    tables: raw.tables || [],
    blockALock: raw.blockALock ?? null,
    blockBLock: raw.blockBLock ?? null,
    blockATableConfirmations: raw.blockATableConfirmations || [],
    blockBTableConfirmations: raw.blockBTableConfirmations || [],
    ko: decodeKo(raw.ko),
    blockA: raw.blockA ? { tournament: decodeTournament(raw.blockA.tournament) } : raw.blockA,
    blockB: raw.blockB ? { tournament: decodeTournament(raw.blockB.tournament) } : raw.blockB
  };
};
