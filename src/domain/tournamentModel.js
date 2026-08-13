// Canonical, serializable tournament-state shapes for the CURRENT RACK HUB
// application (M2G). This module documents and constructs the data that is
// genuinely tournament-authoritative in src/PoolTournamentApp.jsx today — it
// does not redesign tournament behavior, and it is not wired into the
// component yet (see docs/ARCHITECTURE.md).
//
// Pure: no React, no localStorage, no DOM/browser APIs, no classes,
// no Map/Set, no functions stored as data. Every shape here must survive
// `JSON.parse(JSON.stringify(state))` unchanged.
//
// =============================================================================
// SHAPES
// =============================================================================
//
// Config
// ------
// The ACTIVE BBS/format calculation configuration. Mirrors the component's
// `config` state exactly (see createConfig below). This is what recalc(),
// pairing, and the domain match-outcome functions actually read, and it is
// live-editable at any time (including mid-tournament, via the "Tournament
// Settings" modal) — see Tournament.config vs Tournament.tournamentConfig below.
//   {
//     d, k_m, k_r,               // GBR constants (fixed-rack)
//     max_games,                  // fixed-rack race target (racks per match)
//     default_rounds,             // read once, at tournament creation, into Tournament.totalRounds
//     use_rp, rp_per_round, rp_per_mp, rp_elo_multiplier,   // Prestige/RP config
//     ranking_system: 'classic' | 'racks',
//     use_rank,                   // optional Event Score reporting metric
//     format: 'fixed_rack' | 'straight_pool_14_1',
//     straightPool: { ... }       // GBR_14.1 EXPERIMENTAL config; always present
//                                  // (safe defaults) even when format is fixed_rack
//   }
//
// Player
// ------
// A tournament participant, as accumulated by recalc()/reconstructStandingsBeforeRound().
//   {
//     id,                // NOT type-coerced or assumed numeric-only; preserve as-given
//     name,
//     elo,                // current GBR
//     mp, perf, perfCount, games,
//     opps: [],            // opponent ids faced so far (no duplicates)
//     rp,                   // Prestige; 0 when use_rp is false or not accumulated
//     racksWon, racksLost,   // fixed-rack only; 0 for a player who has only played 14.1 matches
//     pointsFor, pointsAgainst, inningsTotal, npd, hs, hgd,  // GBR_14.1 EXPERIMENTAL
//                                                              // aggregates; always present
//                                                              // (default 0), same as recalc()
//     removed,               // soft-withdrawal flag (legacy; NOT a status enum — see below)
//     joinedRound             // round the player entered the tournament; legacy code reads
//                              // this as `(p.joinedRound || 1)`, i.e. absence means round 1
//   }
// `avgPerf` (= perfCount > 0 ? perf / perfCount : 0) is a DERIVED value the
// component computes ad hoc for pairing/sorting/display. It is not persisted
// on Player and is intentionally not part of this canonical shape.
//
// createPlayer() below produces this full, normalized, steady-state shape —
// but current LIVE state does not always hold this shape. Two real transient
// shapes exist and remain valid current state, not malformed data:
//   - a roster/pending-player entry (component `players` state, and
//     `pendingPlayers`) is the minimal subset `{ id, name, elo }`;
//   - a newly-promoted player mid-nextRound() (before the next recalc() pass
//     fills in the rest) is `{ id, name, elo, mp, perf, perfCount, games,
//     racksWon, racksLost, opps, removed, joinedRound, avgPerf }` — missing
//     `rp` and every GBR_14.1 aggregate field.
// validateTournamentState() accepts both of these; it does not require every
// createPlayer() field to be present.
//
// Match
// -----
// Mirrors createPairings()'s match objects, with one confirmed exception —
// see the `format` note below.
//   {
//     id,                 // legacy convention: Date.now() + index within a pairing batch
//     p1, p2,               // FULL participant snapshots at pairing time (not id references) —
//                            // p1.elo/p2.elo are the pre-match GBR snapshot that
//                            // fixedRackMatchOutcome()/straightPoolMatchOutcome() and the
//                            // absent-opponent fallback in beforeRoundStandings.js read
//                            // directly off the match, so this nesting is load-bearing.
//                            // Bye opponent is the sentinel { id: 'bye', name: 'FREILOS', elo: 1300 }.
//     r1, r2,                // fixed-rack rack score; also present (0/0, or other values on a
//                             // bye — see below) on 14.1 and bye matches
//     done, cancelled, bye,   // booleans; recalc()/reconstructStandingsBeforeRound() branch on
//                             // these exactly — done && !cancelled to count, bye short-circuits
//     tbl,                    // table assignment, as currently entered/generated (number or string)
//     format,                  // 'fixed_rack' | 'straight_pool_14_1' | ABSENT
//     // present only when format === 'straight_pool_14_1':
//     target, p1Points, p2Points, innings, p1HighRun, p2HighRun
//   }
//
// IMPORTANT — `format` is only conditionally present in real current state.
// createPairings() always sets it explicitly ('fixed_rack' or
// 'straight_pool_14_1'). The Manual Pairing Editor's final stored match
// object (performApplyManualPairings()) does NOT include a `format` field at
// all. Every current consumer only ever checks `match.format ===
// 'straight_pool_14_1'`, so an absent `format` is already treated as
// fixed-rack throughout the app — this module does not invent a default
// value for it (see createMatch() below): a match with no `format` key is
// legitimate current state, not malformed data.
//
// IMPORTANT — two legacy bye encodings both currently exist and are NOT
// unified here: createPairings() stores a bye as r1: 0, r2: 0; the Manual
// Pairing Editor stores a bye as r1: max_games, r2: 0. Only the `bye: true`
// flag is a reliable signal (this is exactly what the domain replay
// functions already key off). Do not assume r1/r2 shape for a bye match.
//
// NOT modeled: `repeat` is only ever set on createPairings()'s intermediate
// pairing objects (the last-resort forced-repeat fallback) for a console
// warning; the final match-object construction in createPairings() does not
// copy it through, so it never appears in stored/persisted Match state. It
// is not part of this canonical shape.
//
// Round
// -----
// There is no separate Round object in the current application. A "round" is
// the array of Match under a round-number key in Tournament.rounds — exactly
// `allRounds` today. This is intentionally preserved as an object keyed by
// round number (not an array), matching current code throughout
// (recalc, reconstructStandingsBeforeRound, createPairings' bye-history scan,
// CSV export). Converting this to an array is explicitly out of scope for
// M2G — it would be a representation change with no current behavioral
// benefit and real conversion risk.
//
// Tournament
// ----------
//   {
//     schemaVersion,             // see SCHEMA_VERSION below; added by this module, not present
//                                 // on raw legacy autosave snapshots — see validation notes
//     started,                    // boolean lifecycle fact (M2K-A) — see "started" below
//     config,                     // Config, see above — the ACTIVE calculation settings
//     tournamentConfig,            // { title, ...ConfigFields } — a SEPARATE setup/display
//                                   // snapshot. NOT the same object as `config` and NOT
//                                   // guaranteed to match it — see the divergence note below
//     players: [Player],            // tournament.players — participants with accumulated stats
//     roster: [{id,name,elo}],       // component `players` state — the starting-GBR SOURCE.
//                                     // Kept as a separate array, not folded into Player, because
//                                     // current behavior re-resolves each player's starting GBR
//                                     // from this roster on every replay (recalc(),
//                                     // reconstructStandingsBeforeRound()) via
//                                     // `roster.find(pl => pl.id === p.id)?.elo || p.elo` —
//                                     // baking a static startingGbr onto Player at creation time
//                                     // would silently change that live-lookup semantics.
//     pendingPlayers: [{id,name,elo}], // added mid-tournament, awaiting the next round
//     rounds: { [roundNumber]: [Match] }, // allRounds — see "Round" above
//     currentRound,                 // how many rounds have been generated / are official
//     totalRounds                    // tournament.totalRounds; fixed at creation from
//                                      // config.default_rounds, not reassigned afterward today
//   }
//
// started
// -------
// A boolean lifecycle fact, ADDITIVE to the model (M2K-A). It represents the
// same distinction the legacy application currently encodes implicitly as
// `tournament === null` (not started) versus `tournament !== null` (started) —
// see legacyStateAdapter.js's EMPTY/CONFIGURED_PRE_START/RUNNING modes below.
//   started === false -> Round 1 has NOT been officially started (this is the
//                         CONFIGURED_PRE_START mapping's canonical Tournament).
//   started === true  -> Round 1 HAS been started / the tournament is running
//                         (this is the RUNNING mapping's canonical Tournament).
// It is an explicit, authoritative fact — never inferred from player count,
// round count, currentRound, match existence, or pendingPlayers. There is
// intentionally no larger status enum (e.g. 'setup' | 'running' | ...); one
// boolean is the approved scope for this task.
//
// `started` is a lifecycle marker ONLY, not a reset/reload switch. While
// started === false, every other field on Tournament (config,
// tournamentConfig, roster, pendingPlayers, rounds, currentRound,
// totalRounds, ...) remains independently editable/preservable exactly like
// any other pre-start state — nothing is rebuilt from defaults, and nothing
// is discarded, merely because started is false. No code in this module (or
// elsewhere in M2K-A) reconstructs state conditionally on `started`.
//
// createTournamentState() below deliberately does NOT default `started` —
// unlike every other field on Tournament, there is no value that is "safe to
// assume" here without silently hiding a caller's mistake (an omitted
// `started` could otherwise silently misrepresent whether a real tournament
// has actually started). Every call site must state it explicitly;
// validateTournamentState() rejects a non-null Tournament missing a boolean
// `started`. This is deliberately stricter than every other optional/
// legacy-compatible field this module tolerates (see the Player/Match notes
// above) — `started` is new authoritative state this task introduces, not a
// legacy quirk being preserved.
//
// Starting Round 1 (the eventual `started: false` -> `started: true`
// transition, and the corresponding command) is explicitly OUT OF SCOPE for
// M2K-A — see docs/ARCHITECTURE.md.
//
// `config` vs `tournamentConfig` — CONFIRMED DIVERGENCE, both preserved:
// createTournamentConfig() sets both `tournamentConfig` (`{title, ...settings}`)
// and `config` (`settings`) from the same object at tournament setup — at
// that instant they agree. After that they are independently writable and DO
// diverge in real current usage:
//   - saveTitle() (the in-tournament "edit title" flow) updates only
//     `tournamentConfig.title`; `config` has no title field at all.
//   - the "Tournament Settings" modal (`showSettings`) calls
//     `setConfig({...config, d/k_m/k_r/max_games/default_rounds: ...})`
//     directly and NEVER touches `tournamentConfig` — so a mid-tournament
//     settings edit changes what recalc()/pairing actually use, while the
//     "Tournament Overview"/results-header display panels (which read
//     `tournamentConfig.d`, `tournamentConfig.k_m`, etc.) keep showing the
//     value captured at setup time.
//   - both are independently written to and restored from the localStorage
//     autosave snapshot (`snapshot.config`, `snapshot.tournamentConfig`).
// This module represents both, unmerged, exactly as current state does. A
// later, deliberate consolidation of this duplication is a possible TARGET
// direction, not current behavior — see docs/ARCHITECTURE.md.
//
// There is no standalone `Tournament.title` — it lives at
// `tournamentConfig.title` (a prior version of this module added a
// standalone `title` field; that was a redundant duplicate of
// `tournamentConfig.title` and has been removed).
//
// Deliberately NOT part of this shape (see docs/ARCHITECTURE.md and the M2G
// report for the full audit): UI/dialog/tab state, `viewingRound` as a
// navigation concern (it IS captured inside PreAdvanceSnapshot below, for a
// different, operational reason), `tableNumbers`/`seedMethod`/`manualSeeding`
// (one-time round-setup inputs, not stored tournament truth),
// `clubDatabase`/`configPresets` (separate, tournament-independent reference
// datasets), export Blob URLs. `preAdvanceSnapshot` is not part of
// Tournament either — see "Operational/session state" below.
//
// =============================================================================
// OPERATIONAL / SESSION STATE
// =============================================================================
//
// Distinguish three tiers, matching current application reality:
//   Tournament state       = authoritative tournament truth (above).
//   Operational/session state = persisted state required to reproduce
//                                current application OPERATIONS, such as
//                                emergency undo — not itself tournament
//                                truth, but currently autosaved and load-
//                                bearing for a real feature.
//   UI state                = dialogs, selected tabs, temporary form fields,
//                              error-message presentation, export Blob URLs —
//                              never persisted here.
//
// PreAdvanceSnapshot
// ------------------
// A deep-cloned copy taken by nextRound() immediately before advancing the
// round, so confirmUndoAdvance() can restore it exactly. Mirrors
// nextRound()'s actual `setPreAdvanceSnapshot({...})` call precisely,
// including `viewingRound` — which is restored as part of undo
// (`setViewingRound(preAdvanceSnapshot.viewingRound)`), so it is captured
// here even though `viewingRound` is otherwise a UI-navigation concern.
//   {
//     tournament: { players, totalRounds },  // the LEGACY `tournament` state shape at
//                                              // snapshot time — NOT necessarily a full
//                                              // canonical Tournament (see validation notes)
//     allRounds: { [roundNumber]: [Match] },   // allRounds at snapshot time — named `allRounds`,
//                                                // not `rounds`, to match setPreAdvanceSnapshot()'s
//                                                // actual payload key exactly (confirmUndoAdvance()
//                                                // reads `preAdvanceSnapshot.allRounds` verbatim)
//     currentRound,
//     viewingRound,
//     pendingPlayers: [{id,name,elo}]
//   }
//
// ApplicationState
// -----------------
// The smallest wrapper representing what the current app persists (via
// localStorage autosave) beyond raw Tournament truth to reproduce current
// operations:
//   {
//     tournament: Tournament | null,
//     preAdvanceSnapshot: PreAdvanceSnapshot | null
//   }
// Deliberately excludes `clubDatabase`/`configPresets` (separate reference
// data, also autosaved today, but not tournament-operational state) and all
// UI state.

import { STRAIGHT_POOL_DEFAULTS } from './straightPool14_1.js';

// Bump only for an actual breaking change to these shapes. No migration
// framework yet (M2G is additive-only); this exists so persistence/backend
// work has an explicit version to key off later. Raw legacy autosave
// snapshots predate this field entirely — its absence is not itself
// malformed input (see validateTournamentState).
export const SCHEMA_VERSION = 1;

// Config defaults, byte-for-byte the same as PoolTournamentApp.jsx's initial
// `config` useState value. A partial `overrides.straightPool` is merged onto
// STRAIGHT_POOL_DEFAULTS field-by-field — it does not replace the whole
// nested object — matching every current call site that builds a
// straightPool config (`{...STRAIGHT_POOL_DEFAULTS, ...(config.straightPool || {})}`,
// used identically in the format-toggle handler, the useTargetScaledK
// checkbox handler, and the autosave-restore path).
export const createConfig = ({ straightPool, ...overrides } = {}) => ({
  d: 330,
  k_m: 30,
  k_r: 20,
  max_games: 6,
  default_rounds: 4,
  use_rp: true,
  rp_per_round: 10,
  rp_per_mp: 10,
  rp_elo_multiplier: 0.15,
  ranking_system: 'classic',
  use_rank: false,
  format: 'fixed_rack',
  straightPool: { ...STRAIGHT_POOL_DEFAULTS, ...straightPool },
  ...overrides
});

// A tournament participant. Defaults match the union of startTournament()'s
// per-player reset ({mp, perf, games, opps, removed, joinedRound}) and
// recalc()'s full reset (adds perfCount/rp/racksWon/racksLost/14.1
// aggregates) — i.e. the fully normalized, steady-state shape
// Tournament.players holds after a recalculation. Real current live state is
// not always this fully normalized — see the Player shape notes above.
export const createPlayer = ({ id, name, elo, ...overrides } = {}) => ({
  id,
  name,
  elo,
  mp: 0,
  perf: 0,
  perfCount: 0,
  games: 0,
  opps: [],
  rp: 0,
  racksWon: 0,
  racksLost: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  inningsTotal: 0,
  npd: 0,
  hs: 0,
  hgd: 0,
  removed: false,
  joinedRound: 1,
  ...overrides
});

// A match. `format` is left genuinely absent unless the caller supplies it —
// createMatch() does not default it to 'fixed_rack', because real current
// state legitimately omits it entirely (see the Match `format` note above).
// `target`/p1Points/etc. are likewise only added when supplied; this
// constructor does not invent a target default (that's
// getStraightPoolTargetForMatch()'s job, not match creation's).
export const createMatch = ({
  id,
  p1,
  p2,
  bye = false,
  tbl,
  r1 = 0,
  r2 = 0,
  done,
  cancelled = false,
  format,
  ...formatFields
} = {}) => ({
  id,
  p1,
  p2,
  r1,
  r2,
  done: done ?? bye,
  cancelled,
  bye,
  tbl,
  ...(format !== undefined ? { format } : {}),
  ...formatFields
});

// Top-level canonical tournament state. `tournamentConfig` defaults to a
// `{title, ...config}` snapshot (matching createTournamentConfig()'s actual
// construction) when not supplied, but callers should pass their own once
// it's meant to diverge from `config`.
//
// `started` intentionally has NO default — see the "started" notes above.
// Every caller must state it explicitly; an omitted `started` is left
// `undefined` here (not silently coerced to true or false) so
// validateTournamentState() catches it as missing, exactly like any other
// caller mistake.
export const createTournamentState = ({
  started,
  config = createConfig(),
  tournamentConfig = { title: 'Untitled Tournament', ...config },
  players = [],
  roster = players,
  pendingPlayers = [],
  rounds = {},
  currentRound = 0,
  totalRounds = config.default_rounds
} = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  started,
  config,
  tournamentConfig,
  players,
  roster,
  pendingPlayers,
  rounds,
  currentRound,
  totalRounds
});

// A PreAdvanceSnapshot, matching nextRound()'s actual
// setPreAdvanceSnapshot({...}) payload exactly — including the `allRounds`
// key name (confirmUndoAdvance() reads `preAdvanceSnapshot.allRounds`, not
// `.rounds`).
export const createPreAdvanceSnapshot = ({ tournament, allRounds, currentRound, viewingRound, pendingPlayers }) => ({
  tournament,
  allRounds,
  currentRound,
  viewingRound,
  pendingPlayers
});

// The smallest current operational/session wrapper — see "OPERATIONAL /
// SESSION STATE" above. Not a replacement for Tournament; a sibling.
export const createApplicationState = ({ tournament = null, preAdvanceSnapshot = null } = {}) => ({
  tournament,
  preAdvanceSnapshot
});

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Lightweight structural validation for the canonical Tournament top-level
// contract, remaining permissive about optional legacy-compatible Player/
// Match fields (see the shape notes above for exactly which fields are
// genuinely optional in real current state — `format`, `tbl`, 14.1 fields,
// `joinedRound`, and the full Player aggregate set are all NOT required
// here). Checks only what the current domain layer genuinely relies on:
// player/match ids for lookups; done/cancelled/bye as booleans for replay
// branching; rounds as an object, not an array. Does NOT coerce or compare
// id types, and does NOT enforce anything about player counts/pairing
// legality — those are round-lifecycle/pairing concerns, not state-shape
// concerns. Returns a list of errors rather than throwing.
//
// `started` is the one exception to this permissiveness (M2K-A): it is
// REQUIRED and must be a boolean on every non-null Tournament — there is no
// legacy precedent to stay compatible with (it is new authoritative state,
// not a preserved legacy quirk), so a missing/non-boolean value is always
// rejected rather than tolerated.
export const validateTournamentState = (state) => {
  const errors = [];

  if (!isPlainObject(state)) {
    return { valid: false, errors: ['tournament state must be a plain object'] };
  }
  if (typeof state.started !== 'boolean') errors.push('started is required and must be a boolean');
  if (!isPlainObject(state.config)) errors.push('config is required and must be an object');
  if (!isPlainObject(state.tournamentConfig)) errors.push('tournamentConfig is required and must be an object');
  if (!Array.isArray(state.players)) errors.push('players must be an array');
  if (!Array.isArray(state.roster)) errors.push('roster must be an array');
  if (!Array.isArray(state.pendingPlayers)) errors.push('pendingPlayers must be an array');
  if (!isPlainObject(state.rounds)) errors.push('rounds must be a plain object keyed by round number');
  if (typeof state.currentRound !== 'number') errors.push('currentRound must be a number');
  if (typeof state.totalRounds !== 'number') errors.push('totalRounds must be a number');
  // schemaVersion is intentionally not required: raw legacy autosave
  // snapshots predate it and remain valid current state.
  if ('schemaVersion' in state && typeof state.schemaVersion !== 'number') {
    errors.push('schemaVersion must be a number when present');
  }

  if (Array.isArray(state.players)) {
    state.players.forEach((p, i) => {
      if (p == null || p.id === undefined || p.id === null) errors.push(`players[${i}] is missing an id`);
    });
  }

  if (isPlainObject(state.rounds)) {
    Object.entries(state.rounds).forEach(([roundKey, matches]) => {
      if (!Array.isArray(matches)) {
        errors.push(`rounds[${roundKey}] must be an array of matches`);
        return;
      }
      matches.forEach((m, i) => {
        if (m == null) { errors.push(`rounds[${roundKey}][${i}] is missing`); return; }
        if (m.id === undefined || m.id === null) errors.push(`rounds[${roundKey}][${i}] is missing an id`);
        if (!m.p1 || m.p1.id === undefined || m.p1.id === null) errors.push(`rounds[${roundKey}][${i}] is missing p1.id`);
        if (!m.p2 || m.p2.id === undefined || m.p2.id === null) errors.push(`rounds[${roundKey}][${i}] is missing p2.id`);
        if (typeof m.done !== 'boolean') errors.push(`rounds[${roundKey}][${i}].done must be a boolean`);
        if (typeof m.cancelled !== 'boolean') errors.push(`rounds[${roundKey}][${i}].cancelled must be a boolean`);
        if (typeof m.bye !== 'boolean') errors.push(`rounds[${roundKey}][${i}].bye must be a boolean`);
      });
    });
  }

  return { valid: errors.length === 0, errors };
};

// Small, permissive validation for the operational/session wrapper — not a
// schema framework, just the fields confirmUndoAdvance()/the autosave
// restore path actually dereference. `preAdvanceSnapshot.tournament` is
// deliberately NOT run through validateTournamentState(): it's the legacy
// `tournament` state shape ({players, totalRounds}) at snapshot time, not
// necessarily a full canonical Tournament, so it's checked only at the
// lightweight structural level the actual undo path (setTournament(...))
// requires.
export const validateApplicationState = (state) => {
  const errors = [];
  if (!isPlainObject(state)) return { valid: false, errors: ['application state must be a plain object'] };

  if (state.tournament !== null && state.tournament !== undefined) {
    const result = validateTournamentState(state.tournament);
    if (!result.valid) errors.push(...result.errors.map((e) => `tournament.${e}`));
  }
  if (state.preAdvanceSnapshot !== null && state.preAdvanceSnapshot !== undefined) {
    const snap = state.preAdvanceSnapshot;
    if (!isPlainObject(snap)) {
      errors.push('preAdvanceSnapshot must be a plain object when present');
    } else {
      if (!isPlainObject(snap.tournament)) {
        errors.push('preAdvanceSnapshot.tournament must be a plain object');
      } else if (!Array.isArray(snap.tournament.players)) {
        errors.push('preAdvanceSnapshot.tournament.players must be an array');
      }
      if (!isPlainObject(snap.allRounds)) errors.push('preAdvanceSnapshot.allRounds must be a plain object');
      if (!Array.isArray(snap.pendingPlayers)) errors.push('preAdvanceSnapshot.pendingPlayers must be an array');
      if (typeof snap.currentRound !== 'number') errors.push('preAdvanceSnapshot.currentRound must be a number');
      if (typeof snap.viewingRound !== 'number') errors.push('preAdvanceSnapshot.viewingRound must be a number');
    }
  }

  return { valid: errors.length === 0, errors };
};
