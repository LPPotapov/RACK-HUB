// Application-layer commands (M2J): the first real tournament-changing
// operations, built on top of the canonical ApplicationState
// (src/domain/tournamentModel.js) and meant to be composed with
// tournamentStore.js's updateState():
//
//   store.updateState((state) => assignMatchTable(state, { roundNumber, matchId, table }));
//
// Each command here is a pure function: canonical ApplicationState in,
// canonical ApplicationState out, no mutation of its input, no React, no
// BBS/domain calculation, no pairing/round-lifecycle logic. Not a command
// framework — one small named export per operation.

// ---------------------------------------------------------------------------
// assignMatchTable
// ---------------------------------------------------------------------------
//
// CURRENT legacy behavior this preserves exactly (verified by inspecting
// PoolTournamentApp.jsx before writing this — not assumed):
//
//   - The only field changed is `tbl`. The per-match table `<input type="text">`
//     (round view) and the bulk "Configure Table Numbers" modal are the two
//     current mutation paths, and both just overwrite `match.tbl` — no other
//     match field is ever touched by a table edit.
//   - `tbl` has no fixed type. createPairings()/the Manual Pairing Editor
//     always set it to a NUMBER (`idx + 1`, or `tableNumbers[...] || (idx+1)`);
//     once a director edits it via the text `<input>`, it becomes whatever
//     STRING `e.target.value` produced. Nothing in the current app ever
//     coerces or normalizes it back. This command preserves the given
//     `table` value's type exactly — it does not coerce to a number or a
//     string.
//   - An empty value is accepted: the per-match `<input>` has no validation,
//     so a director can clear it to `''`. This command does not reject a
//     falsy/empty `table` value.
//   - Overwriting an existing assignment is unconditionally allowed — both
//     current UI paths simply replace whatever value was there.
//   - The per-match `<input>` is disabled only via `disabled={m.cancelled}` —
//     NOT `m.done`. A completed (`done: true`) match's table remains
//     editable in the current UI. That said, `disabled` is a UI/HTML
//     attribute only; nothing in the underlying `setAllRounds(...)` state
//     update itself checks `cancelled` (or anything else) before applying
//     the change — the actual data-layer operation is unconditional. This
//     command mirrors the data-layer reality (no guard), not the UI's
//     cosmetic `disabled` attribute, since the UI attribute is presentation,
//     not a business rule enforced anywhere in state.
//   - No current code path validates table numbers for uniqueness within a
//     round, in either mutation path. This command does not add that check —
//     doing so would be a new rule, not a preserved one.
//
// This command DOES validate that the referenced round and match exist (and
// throws a clear error if not) — that is not a tournament-behavior rule, just
// well-defined function input handling, matching the pattern already used by
// tournamentStore.js's getStandingsBeforeRound() for its own "nothing to
// operate on" case.
export const assignMatchTable = (applicationState, { roundNumber, matchId, table }) => {
  const tournament = applicationState?.tournament;
  if (!tournament) {
    throw new Error('assignMatchTable: no tournament in this ApplicationState (application is EMPTY)');
  }

  const round = tournament.rounds[roundNumber];
  if (!round) {
    throw new Error(`assignMatchTable: round ${roundNumber} does not exist`);
  }

  const matchIndex = round.findIndex((m) => m.id === matchId);
  if (matchIndex === -1) {
    throw new Error(`assignMatchTable: match ${matchId} does not exist in round ${roundNumber}`);
  }

  const nextRound = round.map((m, i) => (i === matchIndex ? { ...m, tbl: table } : m));

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      rounds: {
        ...tournament.rounds,
        [roundNumber]: nextRound
      }
    }
  };
};
