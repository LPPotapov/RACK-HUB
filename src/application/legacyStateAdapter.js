// Application-layer boundary (M2H, extended M2K-B): maps between the CURRENT
// legacy React state in PoolTournamentApp.jsx and the approved canonical
// ApplicationState (src/domain/tournamentModel.js), in both directions:
//   captureApplicationStateFromLegacy()  legacy runtime state -> canonical
//   projectApplicationStateToLegacy()    canonical -> legacy-compatible runtime state
// See projectApplicationStateToLegacy() below for the reverse direction.
//
// This is a pure MAPPING boundary, not a cleanup pass: it does not
// normalize, default, or unify anything the legacy state itself does not
// already contain. In particular it must NOT:
//   - add `format` to a match that doesn't have one (Manual Pairing Editor matches);
//   - add steady-state Player aggregate fields (rp, 14.1 aggregates, ...) to
//     a transient player object that doesn't have them yet;
//   - unify the two legacy bye encodings;
//   - rename `preAdvanceSnapshot.allRounds` to `rounds` (that field name is
//     the current undo contract — see tournamentModel.js's PreAdvanceSnapshot
//     notes and captureApplicationStateFromLegacy() below).
// It only reshapes which top-level bucket each already-existing piece of
// legacy state belongs in, and guarantees the result is a JSON-safe deep
// clone with no shared mutable references back to the caller's React state.
//
// Pure: no React, no localStorage, no DOM/browser APIs, no classes, no
// Map/Set. Does not read component closures — every input is an explicit
// parameter.

import {
  createApplicationState,
  createPreAdvanceSnapshot,
  createTournamentState,
  validateApplicationState
} from '../domain/tournamentModel.js';

// Maps the legacy runtime state PoolTournamentApp.jsx currently owns into the
// canonical ApplicationState { tournament, preAdvanceSnapshot }.
//
// Inputs correspond 1:1 to current component state:
//   config          - the component's `config` state (active calc settings)
//   tournamentConfig - the component's `tournamentConfig` state (setup/display
//                       snapshot, independently editable title — see
//                       tournamentModel.js's config-vs-tournamentConfig notes).
//                       null before createTournamentConfig() has run.
//   tournament       - the component's `tournament` state, `{players, totalRounds}`,
//                       or null before startTournament() has run
//   players          - the component's `players` state (global roster / the
//                       starting-GBR source — NOT the same array as
//                       tournament.players)
//   pendingPlayers   - the component's `pendingPlayers` state
//   allRounds        - the component's `allRounds` state, becomes canonical
//                       Tournament.rounds (the canonical field is named
//                       `rounds`; the legacy field is named `allRounds` —
//                       this is the one place that rename happens, and it is
//                       intentional per M2G, unlike inside preAdvanceSnapshot)
//   currentRound     - the component's `currentRound` state
//   preAdvanceSnapshot - the component's `preAdvanceSnapshot` state (or null) —
//                         mapped through unchanged field-for-field, INCLUDING
//                         keeping its `allRounds` key exactly as-is, because
//                         that is the real confirmUndoAdvance() contract today
//
// There are three distinct current legacy states, distinguished by
// `tournament`/`tournamentConfig` nullity (createTournamentConfig() is the
// only function that ever sets `tournamentConfig`, and it always runs before
// the "players" tab — where `players`/`pendingPlayers` can be populated —
// becomes reachable; startTournament() is the only function that ever sets
// `tournament`):
//
//   EMPTY             tournamentConfig === null  -> canonical tournament: null
//   CONFIGURED_PRE_START  tournamentConfig !== null, tournament === null
//                     -> a canonical Tournament representing the configured-
//                        but-not-yet-started event (see below), started: false
//   RUNNING           tournament !== null -> canonical Tournament from the
//                        running tournament's own players/totalRounds,
//                        started: true
//
// `started` (M2K-A) is set explicitly per branch above — never inferred from
// player/round counts — and represents the same started/not-started fact the
// legacy app currently encodes implicitly as `tournament === null` versus
// `tournament !== null`. It is a lifecycle marker only: it does not affect,
// reset, or gate any other field this mapping produces.
//
// These are conceptual states derived from existing data for this mapping's
// purposes only — no new persisted `status` field is introduced.
//
// For CONFIGURED_PRE_START: there is no `tournament.players` yet in legacy
// state — nobody has "joined" as an accumulating tournament participant
// (mp/perf/games/opps/... don't exist for anyone yet, since no round has
// been generated) — so canonical `players` is `[]`, not a copy of the
// registered roster; inventing participant records here would fabricate
// player state legacy data doesn't contain. The registered roster (and any
// players added via addPlayerToTournament() before Round 1, which also land
// in `pendingPlayers` — current code does not clear `pendingPlayers` at
// startTournament()) is preserved in `roster`/`pendingPlayers` exactly as
// given. `totalRounds` is read from `config.default_rounds` — the exact
// field startTournament() itself reads to populate `tournament.totalRounds`
// once it runs, so this is not an invented value.
//
// Returns a JSON-safe deep clone (no aliasing back to the inputs), validated
// against validateApplicationState() before being returned; throws if the
// result is structurally invalid (this indicates the caller passed
// inconsistent/incomplete legacy state, not a normal EMPTY/CONFIGURED_PRE_START
// case — both are valid).
export const captureApplicationStateFromLegacy = ({
  config,
  tournamentConfig = null,
  tournament = null,
  players = [],
  pendingPlayers = [],
  allRounds = {},
  currentRound = 0,
  preAdvanceSnapshot = null
} = {}) => {
  let canonicalTournament = null;
  if (tournament) {
    // RUNNING — legacy `tournament !== null` means Round 1 has started.
    canonicalTournament = createTournamentState({
      started: true,
      config,
      tournamentConfig,
      players: tournament.players,
      roster: players,
      pendingPlayers,
      rounds: allRounds,
      currentRound,
      totalRounds: tournament.totalRounds
    });
  } else if (tournamentConfig) {
    // CONFIGURED_PRE_START — legacy `tournament === null` means Round 1 has
    // NOT started, even though the event is fully configured.
    canonicalTournament = createTournamentState({
      started: false,
      config,
      tournamentConfig,
      players: [],
      roster: players,
      pendingPlayers,
      rounds: allRounds,
      currentRound,
      totalRounds: config.default_rounds
    });
  }
  // else: EMPTY — canonicalTournament stays null.

  const canonicalPreAdvanceSnapshot = preAdvanceSnapshot
    ? createPreAdvanceSnapshot({
        tournament: preAdvanceSnapshot.tournament,
        allRounds: preAdvanceSnapshot.allRounds,
        currentRound: preAdvanceSnapshot.currentRound,
        viewingRound: preAdvanceSnapshot.viewingRound,
        pendingPlayers: preAdvanceSnapshot.pendingPlayers
      })
    : null;

  // Deep-clone so the caller's React state can keep changing afterward
  // without mutating this captured snapshot — the same
  // JSON.parse(JSON.stringify(...)) pattern nextRound() already uses for its
  // own preAdvanceSnapshot, applied here to the whole assembled result.
  const applicationState = JSON.parse(JSON.stringify(
    createApplicationState({ tournament: canonicalTournament, preAdvanceSnapshot: canonicalPreAdvanceSnapshot })
  ));

  const result = validateApplicationState(applicationState);
  if (!result.valid) {
    throw new Error(`captureApplicationStateFromLegacy produced an invalid ApplicationState: ${result.errors.join('; ')}`);
  }

  return applicationState;
};

// ---------------------------------------------------------------------------
// projectApplicationStateToLegacy (M2K-B)
// ---------------------------------------------------------------------------
//
// The inverse of captureApplicationStateFromLegacy(): canonical
// ApplicationState -> a plain object shaped exactly like the legacy runtime
// state PoolTournamentApp.jsx owns (and autosaves), so that in the future
// setPlayers(legacy.players), setTournament(legacy.tournament), etc. — or an
// equivalent localStorage-snapshot restore — could consume it directly.
// PoolTournamentApp.jsx is NOT modified or called by this module; this is a
// pure compatibility proof only (M2K-B scope).
//
// Returned shape (matches PoolTournamentApp.jsx's actual autosave snapshot
// fields exactly, minus `clubDatabase` — separate reference data, never
// tournament-operational, already excluded from canonical ApplicationState
// by M2G/M2H):
//   { config, tournamentConfig, tournament, players, pendingPlayers,
//     allRounds, currentRound, preAdvanceSnapshot }
//
// Validates the input via the existing validateApplicationState() (no
// duplicated validation) and throws before doing anything else if it is
// invalid — the input is never read or mutated on failure.
//
// Mapping is per the same three legacy lifecycle modes captureApplicationStateFromLegacy()
// distinguishes, read directly off `started` (M2K-A) rather than re-derived
// heuristically:
//
//   EMPTY (applicationState.tournament === null)
//     -> the actual EMPTY legacy shape: tournamentConfig: null, tournament: null,
//        players: [], pendingPlayers: [], allRounds: {}, currentRound: 0.
//     `config` is deliberately OMITTED from the returned object (not defaulted,
//     not fabricated) — canonical EMPTY ApplicationState literally does not
//     retain a config value (captureApplicationStateFromLegacy() already
//     discards whatever legacy `config` was live when tournament is null; see
//     its own EMPTY branch), so there is nothing to project back. In the real
//     app this is harmless: `config` always exists as the component's own live
//     useState value regardless of restore, and a true EMPTY canonical state
//     was never coupled to any particular config value in the first place.
//
//   CONFIGURED_PRE_START (tournament !== null, tournament.started === false)
//     -> legacy tournament STAYS null (not reconstructed as an object) — the
//        legacy lifecycle fact is tournament nullity, not a field on it.
//        config -> legacy config (live, current canonical value, unmerged/
//                  unsynced with tournamentConfig, exactly as captured)
//        tournamentConfig -> legacy tournamentConfig (same: current canonical
//                  value, not regenerated from config or defaults)
//        roster -> legacy players (the global roster)
//        pendingPlayers -> legacy pendingPlayers, exactly
//        rounds -> legacy allRounds, exactly (no round/match normalization)
//        currentRound -> legacy currentRound, exactly
//     `tournament.players` (always [] pre-start per M2H) and `tournament.started`
//     are NOT projected anywhere — legacy pre-start state has no field for
//     either (there is no tournament object at all before Round 1 starts).
//
//     REPRESENTABILITY RULE — tournament.totalRounds (M2K-B follow-up):
//     canonical CONFIGURED_PRE_START Tournament carries a `totalRounds` field,
//     but current legacy pre-start state has NO independent place to store
//     it — legacy startTournament() always reads config.default_rounds fresh,
//     live, at the moment "Start Tournament" is actually clicked; there is no
//     pre-start `tournament` object to hold a totalRounds value in the
//     meantime. A real canonical CONFIGURED_PRE_START Tournament captured
//     from actual legacy state always has totalRounds === config.default_rounds
//     (captureApplicationStateFromLegacy() sets it from exactly that field),
//     so this is losslessly representable for every state this boundary is
//     actually meant to round-trip.
//
//     Because M2K-A separately allows a director to keep editing canonical
//     `tournament.config` (including config.default_rounds) via
//     store.updateState() while started stays false, it is POSSIBLE to
//     construct an artificial canonical Tournament where totalRounds and
//     config.default_rounds have been made to disagree (e.g. by setting them
//     independently at construction time, bypassing any real legacy capture).
//     Such a state cannot be projected without silently losing one of the two
//     values, silently rewriting one to match the other, or inventing a
//     legacy field that does not exist. This function does none of those:
//     when tournament.totalRounds !== tournament.config.default_rounds for a
//     started:false Tournament, it THROWS a clear, descriptive error instead
//     of producing a lossy or misleading projection. The canonical input is
//     never mutated — validation/comparison only reads it. This is a
//     representability constraint of the CURRENT legacy compatibility
//     boundary only; it says nothing about how a future multi-round-plan
//     system should treat totalRounds (see docs/ARCHITECTURE.md's FUTURE note).
//
//   RUNNING (tournament !== null, tournament.started === true)
//     -> a non-null legacy tournament object, matching current production
//        shape EXACTLY: { players: tournament.players, totalRounds: tournament.totalRounds }.
//        `started` is deliberately NOT added to this object — current legacy
//        code represents "running" purely via tournament nullity, and current
//        production code never reads a `started`/`status` field off
//        `tournament`. Adding one would be canonical-only state leaking into
//        the legacy shape, not a preserved current field.
//        config/tournamentConfig/roster(->players)/pendingPlayers/allRounds/
//        currentRound map exactly as in CONFIGURED_PRE_START above.
//
// In every mode, `preAdvanceSnapshot` is preserved verbatim (or `null`) —
// still the legacy operational shape ({ tournament, allRounds, currentRound,
// viewingRound, pendingPlayers }, with `allRounds` never renamed to `rounds`,
// `tournament` left as whatever legacy-shaped snapshot it already is, and no
// `started` injected into it) — this is exactly what confirmUndoAdvance()
// already reads directly (setTournament(preAdvanceSnapshot.tournament),
// setAllRounds(preAdvanceSnapshot.allRounds), etc.), so the projected value
// is usable by that function unchanged.
//
// Round/match data (allRounds) is mapped, not normalized: object-keyed round
// structure, match array order, id types, p1/p2 snapshots, scores, done/
// cancelled/bye, tbl, an absent `format`, both legacy bye encodings, target/
// points/innings/high-run fields, and any other transient/optional field all
// pass through completely unchanged — this function never calls createMatch()
// or otherwise reconstructs a match object.
//
// Returns a JSON-safe deep clone (JSON.parse(JSON.stringify(...)), the same
// pattern used throughout this module) — the returned object shares no
// mutable references with the input ApplicationState, so mutating the
// projected config/players/tournament.players/matches/undo snapshot can never
// mutate the canonical input.
export const projectApplicationStateToLegacy = (applicationState) => {
  const result = validateApplicationState(applicationState);
  if (!result.valid) {
    throw new Error(`projectApplicationStateToLegacy: invalid ApplicationState: ${result.errors.join('; ')}`);
  }

  const { tournament, preAdvanceSnapshot = null } = applicationState;

  let legacy;
  if (!tournament) {
    // EMPTY — see the "config is deliberately OMITTED" note above.
    legacy = {
      tournamentConfig: null,
      tournament: null,
      players: [],
      pendingPlayers: [],
      allRounds: {},
      currentRound: 0,
      preAdvanceSnapshot
    };
  } else if (tournament.started === false) {
    // CONFIGURED_PRE_START — see the totalRounds representability rule above.
    // Current legacy pre-start state has nowhere to hold totalRounds
    // independently of config.default_rounds; reject rather than silently
    // lose/rewrite/regenerate a genuine divergence.
    if (tournament.totalRounds !== tournament.config.default_rounds) {
      throw new Error(
        `projectApplicationStateToLegacy: cannot project a CONFIGURED_PRE_START Tournament whose totalRounds `
        + `(${tournament.totalRounds}) differs from config.default_rounds (${tournament.config.default_rounds}) `
        + `— current legacy pre-start state has no independent field for totalRounds before Round 1 starts.`
      );
    }
    legacy = {
      config: tournament.config,
      tournamentConfig: tournament.tournamentConfig,
      tournament: null,
      players: tournament.roster,
      pendingPlayers: tournament.pendingPlayers,
      allRounds: tournament.rounds,
      currentRound: tournament.currentRound,
      preAdvanceSnapshot
    };
  } else {
    // RUNNING — validateApplicationState() has already guaranteed `started`
    // is a boolean, so the only remaining possibility here is `true`.
    legacy = {
      config: tournament.config,
      tournamentConfig: tournament.tournamentConfig,
      tournament: { players: tournament.players, totalRounds: tournament.totalRounds },
      players: tournament.roster,
      pendingPlayers: tournament.pendingPlayers,
      allRounds: tournament.rounds,
      currentRound: tournament.currentRound,
      preAdvanceSnapshot
    };
  }

  return JSON.parse(JSON.stringify(legacy));
};
