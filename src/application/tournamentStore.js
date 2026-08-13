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
// no EventEmitter, no React, no browser APIs, no persistence. Deliberately
// does NOT implement any tournament-lifecycle command yet (no
// startTournament/nextRound/completeMatch/undo/...) — only state ownership,
// validation, mutation isolation, and one read/query that demonstrates using
// the domain layer without putting formulas back in application code.
//
// legacyStateAdapter.js remains the only bridge from legacy React state; this
// module never reads PoolTournamentApp.jsx's shape and accepts canonical
// ApplicationState only.

import { reconstructStandingsBeforeRound } from '../domain/beforeRoundStandings.js';
import { validateApplicationState } from '../domain/tournamentModel.js';

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

  return { getState, replaceState, updateState, getStandingsBeforeRound };
};
