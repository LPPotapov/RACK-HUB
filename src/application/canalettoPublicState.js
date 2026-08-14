// Public projection of a CanalettoEvent (Canaletto Cup 2026 cloud sync pass
// — see docs/decisions/0005-firebase-realtime-backend.md). Written to the
// Realtime Database's `publicState` node, which the already-configured
// security rules make readable by ANYONE — so this is a security-relevant
// redaction, not a convenience helper. It is therefore deliberately
// EXPLICIT (every kept/dropped field named directly) rather than a
// generic deep-omit utility, so a reviewer can audit exactly what leaves
// the director-only boundary by reading this one function.
//
// Reuses the SAME CanalettoEvent shape/field names for everything it keeps
// (never a flattened/pre-computed summary) — the existing public page
// components (LivescorePage.jsx, Top12OverlayPage.jsx,
// BlockResultsOverlayPage.jsx, BracketOverlayPage.jsx, TvOverlayPage.jsx)
// already call the SAME query functions (getBlockStandings,
// getBlockResultsRows, getBracketProjection, resolveTvMatch, etc.) against
// whatever `event`-shaped object they're given; feeding them this redacted
// object instead of the full local one requires no changes to their
// rendering logic. This is why nothing here is "recomputed" — computing a
// second, summarized representation would be exactly the "second
// authoritative implementation" AGENTS.md/docs/ARCHITECTURE.md forbid.
//
// WHITELISTED (per director correction — "include only what the existing
// public livescore / OBS views need"):
//   - per block: roster (name + starting GBR), players (current computed
//     standings), rounds (generated matchups/results, frozen GBR via each
//     match's own p1.elo/p2.elo snapshot), currentRound, totalRounds,
//     config (BBS calc config — needed for expectedScore()/win% by the
//     SAME frozenMatchDisplay() the admin UI already uses), started.
//   - top-level: settings, schedule, blockALock/blockBLock (frozen
//     qualifiers — also the Top16 seeding source), block table
//     confirmation lists, ko (all stages/results), koGbrWeight.
//   - tables, reduced to {order, label} only.
//
// EXCLUDED (director-only operational state — never copied here):
//   - each block's `pendingPlayers` (no public page renders it) and
//     `preAdvanceSnapshot` (the emergency "undo round advance" buffer —
//     purely a director recovery tool).
//   - each table's `billardPadId`/`scoreLink` (integration metadata, never
//     displayed publicly).
//   - anything about backups, restore, danger-zone, auth/session, or sync
//     bookkeeping — none of that is stored on `event` at all (it's
//     transient React/UI state or lives in this event's OWN cloud-sync
//     layer, never inside the tournament data itself).
//
// `liveState` is accepted to match the requested `derivePublicState(event,
// liveState)` signature, but nothing from it is copied into the output in
// this pass: the "live draft scores" the public livescore page needs are
// already the OFFICIAL r1/r2 values inside `rounds`/`ko` above, which now
// reach the public page in real time via the Realtime Database listener
// instead of requiring a same-browser-tab `storage` event. The manual
// broadcast/stream score (liveState.tvScores) stays exclusively on the
// separate `live` RTDB node — it must never appear in a publicly-readable
// tournament-data payload, matching the existing principle that the
// stream score is independent of official results.
export const CANALETTO_PUBLIC_STATE_VERSION = 1;

const publicTournament = (tournament) => ({
  roster: tournament.roster,
  players: tournament.players,
  rounds: tournament.rounds,
  currentRound: tournament.currentRound,
  totalRounds: tournament.totalRounds,
  config: tournament.config,
  started: tournament.started
});

const publicTables = (tables) => (tables || []).map((t) => ({ order: t.order, label: t.label }));

// Firebase RTDB's `set()` throws on ANY `undefined` value anywhere in the
// written object (e.g. `event.koGbrWeight` before it's ever been explicitly
// configured — see getKoGbrWeight()'s own default-fallback in
// canalettoEvent.js). A JSON round trip is the simplest correct fix: it
// both drops `undefined` keys (matching `JSON.stringify`'s normal
// behavior) and guarantees the result is a fully detached plain-JSON clone
// with no shared references back into `event` — appropriate for a value
// about to be sent over the network.
const toJsonSafe = (value) => JSON.parse(JSON.stringify(value));

// Lightweight structural check for the REDUCED public shape — deliberately
// NOT canalettoEvent.js's validateCanalettoEvent() (urgent-blocker fix):
// that validator requires full-CanalettoEvent-only fields this projection
// intentionally omits (each block's `pendingPlayers`/`preAdvanceSnapshot`),
// so a genuine publicState payload always fails it. Any consumer of the
// `publicState` RTDB node (useCloudPublicEvent.js) must validate incoming
// data against THIS schema, and must never route it through
// validateCanalettoEvent()/restoreCanalettoEvent() — those exist solely for
// the full-event `privateState` node and the local JSON backup/restore
// feature.
export const validatePublicState = (parsed) => {
  const errors = [];
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ['publicState must be a plain object'] };
  }
  if (parsed.publicStateVersion !== CANALETTO_PUBLIC_STATE_VERSION) {
    errors.push(`Unsupported publicStateVersion "${parsed.publicStateVersion}" — expected ${CANALETTO_PUBLIC_STATE_VERSION}`);
  }
  ['blockA', 'blockB'].forEach((block) => {
    const tournament = parsed[block] && parsed[block].tournament;
    if (typeof tournament !== 'object' || tournament === null) {
      errors.push(`${block}.tournament must be an object`);
      return;
    }
    if (!Array.isArray(tournament.roster)) errors.push(`${block}.tournament.roster must be an array`);
    if (!Array.isArray(tournament.players)) errors.push(`${block}.tournament.players must be an array`);
    if (typeof tournament.rounds !== 'object' || tournament.rounds === null || Array.isArray(tournament.rounds)) {
      errors.push(`${block}.tournament.rounds must be a plain object keyed by round number`);
    }
  });
  if (typeof parsed.settings !== 'object' || parsed.settings === null) errors.push('settings must be an object');
  if (!Array.isArray(parsed.tables)) errors.push('tables must be an array');
  if (typeof parsed.ko !== 'object' || parsed.ko === null) errors.push('ko must be an object');
  return { valid: errors.length === 0, errors };
};

export const derivePublicState = (event, liveState) => toJsonSafe({
  publicStateVersion: CANALETTO_PUBLIC_STATE_VERSION,
  updatedAt: new Date().toISOString(),
  settings: event.settings,
  schedule: event.schedule,
  tables: publicTables(event.tables),
  blockA: { tournament: publicTournament(event.blockA.tournament) },
  blockB: { tournament: publicTournament(event.blockB.tournament) },
  blockALock: event.blockALock,
  blockBLock: event.blockBLock,
  blockATableConfirmations: event.blockATableConfirmations,
  blockBTableConfirmations: event.blockBTableConfirmations,
  ko: event.ko,
  koGbrWeight: event.koGbrWeight
});
