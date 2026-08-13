// Application-layer commands (M2J, extended M2L): the real tournament-
// changing operations, built on top of the canonical ApplicationState
// (src/domain/tournamentModel.js) and meant to be composed with
// tournamentStore.js's updateState():
//
//   store.updateState((state) => assignMatchTable(state, { roundNumber, matchId, table }));
//
// Each command here is a pure function: canonical ApplicationState in,
// canonical ApplicationState out, no mutation of its input, no React. No
// BBS/pairing calculation lives directly in this file — startTournament()
// below delegates Round 1 generation to src/domain/pairing.js, the same
// pattern assignMatchTable already avoided needing (it has no pairing
// concern at all). Not a command framework — one small named export per
// operation.

import { generatePairings as generatePairingsCommand } from '../domain/pairing.js';

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

// ---------------------------------------------------------------------------
// startTournament
// ---------------------------------------------------------------------------
//
// CURRENT legacy behavior this preserves exactly (verified by direct
// inspection of PoolTournamentApp.jsx's startTournament()/createPairings()
// before writing this — not assumed):
//
//   - Reads: the component's `players` (global roster), `config` (active
//     calc settings), `seedMethod`, `manualSeeding`, `tableNumbers`, and
//     `allRounds` (for bye-history, always {} at this point in real usage).
//   - Writes: `tournament` ({ players, totalRounds }), `allRounds`
//     (REPLACED wholesale with `{ 1: matches }`, not merged with whatever
//     was there before), `currentRound` (1). Also `viewingRound` (1) and
//     `view` ('round') — both UI-navigation state with no canonical home
//     (see tournamentModel.js's Tournament notes), so this command has
//     nothing to write for them.
//   - Does NOT touch: `tournamentConfig`, the global `players`/roster,
//     `pendingPlayers` (current code does not clear pendingPlayers here —
//     see legacyStateAdapter.js's CONFIGURED_PRE_START notes; a player
//     registered via addPlayerToTournament() before start lands in BOTH the
//     roster and pendingPlayers, and starting the tournament leaves that
//     duplication exactly as-is), or `preAdvanceSnapshot` (nextRound() is
//     the only thing that ever writes a snapshot; starting Round 1 creates
//     none — there is nothing yet to "undo" back to).
//   - Player initialization: `tournamentPlayers = sortedPlayers.map(p => ({
//     ...p, mp: 0, perf: 0, games: 0, opps: [], removed: false,
//     joinedRound: 1 }))` — a MINIMAL transient shape, deliberately NOT the
//     full createPlayer()/recalc() steady-state shape: it has no
//     `perfCount`, `racksWon`, `racksLost`, `rp`, or any GBR_14.1 aggregate
//     field. In the real running app, the `recalc()` useEffect fires
//     immediately after (reacting to the `allRounds`/`currentRound`
//     changes) and normalizes/replaces `tournament.players` into the full
//     steady-state shape — but that is `recalc()`'s job, a separate,
//     already-existing, general-purpose mechanism that reacts identically
//     to every round-lifecycle change (nextRound(), completeMatch(), ...),
//     not something specific to "starting" a tournament. Extracting a pure
//     equivalent of `recalc()`'s full-history-replay-with-RP loop is
//     explicitly out of scope for M2L ("result recalculation changes" is
//     listed as out of scope) — this command reproduces exactly what
//     startTournament() itself writes, matching this codebase's existing,
//     approved precedent for a legitimate pre-recalc() transient Player
//     shape (see tournamentModel.js's Player notes on the mid-nextRound()
//     promoted-player shape, which is likewise pre-recalc() and even more
//     complete than this one). Recommended for M2M scope — see the M2L
//     final report.
//   - Starting GBR source: `sortedPlayers = [...players]` — the GLOBAL
//     ROSTER (canonical `tournament.roster`), never `tournament.players`
//     (which does not exist pre-start). This command reads
//     `tournament.roster` accordingly, never merging it with anything else.
//   - Seeding (`seedMethod`, read as an explicit command argument — it is
//     UI-only round-setup state with no canonical home, per
//     tournamentModel.js's existing `seedMethod`/`manualSeeding`/
//     `tableNumbers` exclusion notes, exactly like `manualSeeding` and
//     `tableNumbers` below):
//       'elo'       -> roster sorted by elo descending, THEN paired via
//                       Swiss/cost-based pairing (NOT direct 1v2/3v4 — sort
//                       order and pairing STYLE are two separate decisions;
//                       see below).
//       'cross_elo' -> roster sorted by elo descending, THEN paired
//                       directly: top half vs bottom half. This is "Cross
//                       GBR" seeding — the seed method the historical 14.1
//                       tournament this replay targets actually used (see
//                       the dedicated cross_elo characterization tests).
//       'random'    -> roster shuffled (Math.random() - 0.5), THEN paired
//                       directly, sequentially (0v1, 2v3, ...).
//       'manual'    -> `manualSeeding` (an array of roster ids) resolved
//                       through `roster.find()`, dropping any id that
//                       doesn't resolve (`.filter(Boolean)`), THEN paired
//                       directly, sequentially.
//       anything else -> roster order unchanged (no sort), THEN paired via
//                       Swiss/cost-based pairing — the same pairing STYLE as
//                       'elo', just without the elo sort first.
//     This sorted/ordered list is what both becomes `tournament.players`
//     AND is handed to pairing — `seedMethod` is NOT re-read for sorting
//     there; the component passes it straight through to createPairings(),
//     which is what actually decides pairing STYLE (direct vs Swiss/cost-
//     based) — see src/domain/pairing.js's `generatePairings()`. Only
//     'random'/'cross_elo'/'manual' get direct Round-1 pairing; 'elo' and
//     any unrecognized value fall through to Swiss/cost-based pairing
//     regardless of how the roster was sorted beforehand — this asymmetry
//     (sorting and pairing style are independent) is real current behavior,
//     preserved exactly, not a bug this command fixes.
//   - `seedMethod` is REQUIRED here (no default) — unlike the legacy
//     component, which always has a real value via `useState('random')`,
//     this command has no UI default to fall back on; omitting it would
//     silently choose a specific current-legacy pairing strategy on the
//     caller's behalf, exactly the kind of hidden default this codebase's
//     `started` field precedent (M2K-A) already established should be
//     avoided. `manualSeeding` and `tableNumbers` DO default to `[]`,
//     matching the component's own initial state for both.
//   - Round 1 generation: delegates entirely to
//     src/domain/pairing.js's `generatePairings()` — a faithful, unmodified
//     extraction of createPairings() (see that file's own header for the
//     full characterization: bye assignment, seeding-aware direct pairing,
//     Swiss/cost-based pairing, 14.1 tier-target stamping, table numbering).
//     No pairing algorithm/formula changes here.
//   - `totalRounds = tournament.config.default_rounds` — read at the moment
//     Round 1 actually starts, exactly matching current legacy behavior.
//     This is the CURRENT legacy compatibility value only; it makes no
//     claim about the FUTURE RACK HUB event-length/shortening model (see
//     docs/ARCHITECTURE.md).
//   - `no legal bye` (whitepaper §9.2): current legacy code has a real
//     ordering quirk here — `setTournament(...)` runs UNCONDITIONALLY
//     BEFORE createPairings() is even called, so if pairing then returns
//     null, legacy is left with `tournament !== null` but `allRounds`/
//     `currentRound` never updated (a broken half-started state outside the
//     three normal lifecycle modes).
//     No-legal-bye failure is UNREACHABLE THROUGH NORMAL CURRENT
//     UI-CREATED pre-start state: a director-driven CONFIGURED_PRE_START
//     state always has an empty `allRounds` (no rounds exist before Round 1
//     starts) and every starting player has `joinedRound === 1`, so bye
//     history and new-player protection are both necessarily empty, and
//     `generatePairings()` can only return null in that case if the roster
//     itself is empty (which never enters the bye branch at all, since 0 is
//     even). It is NOT unreachable for every structurally valid canonical
//     CONFIGURED_PRE_START state, though: M2K-A's pre-start editability
//     already permits constructing an artificial canonical Tournament whose
//     `rounds` contains old round history marking every player as already
//     bye-ineligible (see the dedicated "artificial prior-bye" test). For
//     that artificial input, this command throws atomically BEFORE
//     committing any change — it does not reproduce legacy's theoretical
//     partial-mutation ordering bug (legacy's React state would already
//     have scheduled `setTournament(...)` by the point of failure; this
//     command's `updateState()`-composed atomicity guarantees no such
//     partial commit is possible here). This edge is not reachable through
//     ordinary current UI workflow. (For a LATER round, once real bye
//     history exists through normal play, this branch becomes reachable
//     through ordinary use too — that's nextRound()'s concern, not this
//     command's — M2M scope.)
//   - Zero-player roster: current legacy code has no guard against starting
//     with zero registered players — `sortedPlayers`/`tournamentPlayers`
//     become `[]`, pairing produces zero matches, and the tournament
//     "starts" with `players: []`, `rounds: { 1: [] }`. This command does
//     not add a new rule here — that would be inventing legacy behavior
//     that does not exist, not preserving it.
//
// Lifecycle: requires `tournament.started === false` (CONFIGURED_PRE_START);
// on success, `started` becomes `true` (RUNNING) — explicit, never inferred
// from player/round counts (M2K-A).
export const startTournament = (applicationState, { seedMethod, manualSeeding = [], tableNumbers = [] } = {}) => {
  const tournament = applicationState?.tournament;
  if (!tournament) {
    throw new Error('startTournament: no tournament in this ApplicationState (application is EMPTY)');
  }
  if (tournament.started !== false) {
    throw new Error('startTournament: tournament has already started (started must be false)');
  }
  if (seedMethod === undefined || seedMethod === null) {
    throw new Error('startTournament: seedMethod is required');
  }

  let sortedPlayers = [...tournament.roster];
  if (seedMethod === 'elo' || seedMethod === 'cross_elo') {
    sortedPlayers.sort((a, b) => b.elo - a.elo);
  } else if (seedMethod === 'random') {
    sortedPlayers.sort(() => Math.random() - 0.5);
  } else if (seedMethod === 'manual') {
    sortedPlayers = manualSeeding.map((id) => tournament.roster.find((p) => p.id === id)).filter(Boolean);
  }
  // Any other value: keeps roster order unchanged, exactly like current code.

  const tournamentPlayers = sortedPlayers.map((p) => ({
    ...p,
    mp: 0,
    perf: 0,
    games: 0,
    opps: [],
    removed: false,
    joinedRound: 1
  }));

  const matches = generatePairingsCommand(tournamentPlayers, {
    startTableIndex: 0,
    roundNum: 1,
    seedMethod,
    allRounds: tournament.rounds,
    tableNumbers,
    config: tournament.config
  });

  if (matches === null) {
    // See the "no legal bye" note above — unreachable through normal
    // current UI-created pre-start state, but reachable for a structurally
    // valid artificial canonical pre-start state (old round history marking
    // every player bye-ineligible). This throws atomically before any
    // change is committed, rather than reproducing legacy's theoretical
    // partial-commit ordering bug.
    throw new Error('startTournament: no legal bye available for Round 1 (whitepaper §9.2)');
  }

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      started: true,
      players: tournamentPlayers,
      totalRounds: tournament.config.default_rounds,
      rounds: { 1: matches },
      currentRound: 1
    }
  };
};
