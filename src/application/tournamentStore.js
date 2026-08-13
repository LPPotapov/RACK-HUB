// Application-layer store (M2I): the first thing that OWNS a canonical
// ApplicationState value in memory, independently of both React
// (PoolTournamentApp.jsx still owns the real running application state) and
// of any backend/persistence (none exists yet). This is the seam a future
// HTTP backend can wrap directly:
//
//   legacy React state -> captureApplicationStateFromLegacy() -> canonical
//   ApplicationState -> createTournamentStore(...) -> domain functions
//
// A small plain-JavaScript factory, not a framework: no Redux/Zustand/MobX,
// no EventEmitter, no React, no browser APIs, no persistence. Implements
// three tournament-changing commands so far (M2J's assignMatchTable, M2L's
// startTournament, and M2M-B's recordMatchResult — see below); the rest of
// the tournament lifecycle (nextRound/undo/...) remains future, one-at-a-
// time migrations. It also exposes one read/query that demonstrates using
// the domain layer without putting formulas back in application code.
//
// legacyStateAdapter.js remains the only bridge from legacy React state; this
// module never reads PoolTournamentApp.jsx's shape and accepts canonical
// ApplicationState only.

import { reconstructStandingsBeforeRound } from '../domain/beforeRoundStandings.js';
import { validateApplicationState } from '../domain/tournamentModel.js';
import {
  assignMatchTable as assignMatchTableCommand,
  recordMatchResult as recordMatchResultCommand,
  startTournament as startTournamentCommand
} from './tournamentCommands.js';

// JSON-safe deep clone — the same JSON.parse(JSON.stringify(...)) pattern
// already used by nextRound()'s undo snapshot and legacyStateAdapter.js.
// ApplicationState is plain JSON-compatible data by contract (tournamentModel.js),
// so this is sufficient and keeps the store dependency-free.
const clone = (value) => JSON.parse(JSON.stringify(value));

const assertValid = (label, applicationState) => {
  const result = validateApplicationState(applicationState);
  if (!result.valid) {
    throw new Error(`${label}: invalid ApplicationState: ${result.errors.join('; ')}`);
  }
};

// Owns one canonical ApplicationState value. Every read and write clones
// through JSON, so:
//   - mutating `initialApplicationState` after the store is created,
//   - mutating the object returned by getState(),
//   - mutating a state object after passing it to replaceState()/updateState(),
// can never affect the store's internal state.
export const createTournamentStore = (initialApplicationState) => {
  assertValid('createTournamentStore', initialApplicationState);
  let state = clone(initialApplicationState);

  // Returns an isolated copy of the current ApplicationState.
  const getState = () => clone(state);

  // Replaces the store's ApplicationState wholesale. On invalid input, throws
  // and leaves the previous valid internal state completely unchanged.
  const replaceState = (nextApplicationState) => {
    assertValid('tournamentStore.replaceState', nextApplicationState);
    state = clone(nextApplicationState);
  };

  // Convenience wrapper: calls `updater` with an isolated copy of the current
  // state and replaceState()s the result — so a caller can compute a next
  // state from the current one without a separate getState() round-trip,
  // while still going through the same validation/cloning as replaceState().
  // Not a mutation API: `updater` must return a new ApplicationState value,
  // not mutate its argument in place (mutating it would be harmless to the
  // store either way, since that argument is already an isolated clone, but
  // the return value is what actually gets committed).
  const updateState = (updater) => {
    replaceState(updater(getState()));
  };

  // Application-level query: reconstructs standings as of strictly before
  // `roundLimit`, delegating entirely to the domain layer
  // (reconstructStandingsBeforeRound) — no formulas here, and this never
  // mutates the store's state. Mirrors the M2F semantics exactly: only
  // players eligible as of roundLimit are included, an absent historical
  // opponent's match-stored GBR snapshot is still used correctly, and no
  // RP/Prestige is tracked (this is pairing-preparation input, not a general
  // recalculation — see beforeRoundStandings.js).
  //
  // Throws if the application is EMPTY (no `tournament` to query) — legacy
  // code never calls the equivalent buildStandingsBeforeRound() without an
  // active tournament, so there is no current behavior to preserve for that
  // case, and returning a silently-empty result could be mistaken for "a
  // tournament with zero eligible players" rather than "no tournament at
  // all". A CONFIGURED_PRE_START tournament (real Tournament, but
  // `players: []`) is valid and simply reconstructs to `{}`.
  const getStandingsBeforeRound = (roundLimit) => {
    const { tournament } = getState();
    if (!tournament) {
      throw new Error('tournamentStore.getStandingsBeforeRound: no tournament in this ApplicationState (application is EMPTY)');
    }
    return reconstructStandingsBeforeRound({
      players: tournament.players,
      startingRoster: tournament.roster,
      rounds: tournament.rounds,
      roundLimit,
      config: tournament.config
    });
  };

  // Application command: assigns/changes a single match's table (`tbl`),
  // committed atomically through updateState() — no separate validation,
  // cloning, or command logic here; this is a thin wrapper over the pure
  // assignMatchTable() command from tournamentCommands.js, which owns the
  // characterized legacy table semantics (number-or-string, blank allowed,
  // overwrite allowed, done/cancelled matches still changeable, no
  // uniqueness enforcement — see tournamentCommands.js). If the round/match
  // doesn't exist, or the application is EMPTY, the command throws before
  // updateState()'s replaceState() call is ever reached, so the store's
  // state is left exactly as it was (same atomicity guarantee already
  // proven for updateState() in general).
  const assignMatchTable = (args) => {
    updateState((current) => assignMatchTableCommand(current, args));
  };

  // Application command: transitions a CONFIGURED_PRE_START tournament
  // (started: false) to RUNNING (started: true) and generates Round 1,
  // committed atomically through updateState() — no separate validation,
  // cloning, or pairing/lifecycle logic here; this is a thin wrapper over
  // the pure startTournament() command from tournamentCommands.js, which
  // owns the characterized legacy startTournament()/createPairings()
  // semantics (see tournamentCommands.js and src/domain/pairing.js). If the
  // application is EMPTY, the tournament has already started, `seedMethod`
  // is missing, or no legal bye exists for Round 1, the command throws
  // before updateState()'s replaceState() call is ever reached, so the
  // store's state is left exactly as it was (same atomicity guarantee
  // already proven for updateState() in general).
  const startTournament = (args) => {
    updateState((current) => startTournamentCommand(current, args));
  };

  // Application command: records or corrects a single match's result
  // (fixed-rack r1/r2, or 14.1 points/innings/high-runs) and atomically
  // recalculates tournament.players from the full updated history —
  // committed through updateState() with no separate validation, cloning,
  // result, or recalculation logic here; this is a thin wrapper over the
  // pure recordMatchResult() command from tournamentCommands.js, which owns
  // the characterized legacy completeMatch() semantics (see
  // tournamentCommands.js and src/domain/tournamentRecalculation.js). If
  // the application is EMPTY/not started, the round/match doesn't exist,
  // the match is a bye, or the result fails current validation, the command
  // throws before updateState()'s replaceState() call is ever reached, so
  // the store's state is left exactly as it was (same atomicity guarantee
  // already proven for updateState() in general).
  const recordMatchResult = (args) => {
    updateState((current) => recordMatchResultCommand(current, args));
  };

  return { getState, replaceState, updateState, getStandingsBeforeRound, assignMatchTable, startTournament, recordMatchResult };
};
