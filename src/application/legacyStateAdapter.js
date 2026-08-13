// Application-layer boundary (M2H): maps the CURRENT legacy React state in
// PoolTournamentApp.jsx into the approved canonical ApplicationState
// (src/domain/tournamentModel.js), one direction only — legacy runtime state
// -> canonical ApplicationState. No reverse mapping yet (see docs/ARCHITECTURE.md).
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
