// Canaletto CURRENT-ROUND operator controls (operator-control pass): three
// pure ApplicationState -> ApplicationState operations the generic
// tournamentCommands.js has no equivalent for. Each is scoped to
// `tournament.currentRound` only; every earlier round is always left
// byte-for-byte unchanged. No BBS/GBR/PERF formula is reimplemented — every
// numeric consequence is produced by calling the SAME existing
// `recalculateTournamentPlayers()` domain function the rest of the app
// already uses.
//
// These are generic ApplicationState operations (no Block A/B concept) —
// src/application/canalettoEvent.js wraps each with the same block-scoping/
// lock-guard pattern already used for the other block commands.

import { generatePairings } from '../domain/pairing.js';
import { reconstructStandingsBeforeRound } from '../domain/beforeRoundStandings.js';
import { compareFixedRackPairingOrder } from '../domain/fixedRackBbs.js';
import { recalculateTournamentPlayers } from '../domain/tournamentRecalculation.js';

const BYE_SENTINEL = { id: 'bye', name: 'FREILOS', elo: 1300 };

const currentRoundMatch = (tournament, matchId) => {
  const round = tournament.rounds[tournament.currentRound];
  if (!round) throw new Error(`round ${tournament.currentRound} does not exist`);
  const match = round.find((m) => m.id === matchId);
  if (!match) throw new Error(`match ${matchId} does not exist in round ${tournament.currentRound}`);
  return { round, match };
};

const recalcFrom = (tournament, updatedRounds) => recalculateTournamentPlayers({
  players: tournament.players,
  roster: tournament.roster,
  rounds: updatedRounds,
  currentRound: tournament.currentRound,
  config: tournament.config
});

// ---------------------------------------------------------------------------
// Missing-this-round / bye conversion
// ---------------------------------------------------------------------------
//
// AUTHORITATIVE result (director-specified, reusing the EXISTING canonical
// bye rule from tournamentRecalculation.js's applyByeMatch() unchanged):
//   OPPONENT: +1 MP, normal bye RP (rp_per_round + rp_per_mp when enabled),
//             no games increment, no GBR/PERF change, no rack/opponent
//             contribution.
//   MISSING PLAYER: nothing at all — no MP/RP/game/GBR/PERF, no penalty.
//
// HOW: the match is transformed into the EXACT same bye shape
// generatePairings() itself produces for an odd-count bye (bye: true,
// p2: the FREILOS sentinel, r1/r2: 0, done: true) — so
// recalculateTournamentPlayers()'s existing, already-tested bye branch
// (applyByeMatch()) handles it identically to any other bye, with NO
// reimplementation of bye math here. The missing player's id simply no
// longer appears anywhere in this match, so replay never touches their
// derived stats for this round — this is what "receives nothing" actually
// means structurally, not a special-cased skip.
//
// ROUND-LOCAL, NOT PERMANENT (director requirement — no `removed: true`,
// no roster change): the match's ORIGINAL p1/p2/r1/r2/done/cancelled/bye are
// preserved verbatim under `canalettoMissing.originalMatch` (a full clone),
// the smallest safe representation that lets undoPlayerMissingThisRound()
// below restore the exact original matchup rather than inventing a new one.
// `canalettoMissing` is a Canaletto-only match extension field; no existing
// canonical Match field is renamed, removed, or reinterpreted.
export const markPlayerMissingThisRound = (applicationState, { matchId, missingPlayerId }) => {
  const tournament = applicationState?.tournament;
  if (!tournament) throw new Error('markPlayerMissingThisRound: no tournament in this ApplicationState');
  if (tournament.started !== true) throw new Error('markPlayerMissingThisRound: tournament has not started yet');

  const { round, match } = currentRoundMatch(tournament, matchId);
  if (match.bye) throw new Error('markPlayerMissingThisRound: match is already a bye');
  if (match.done) throw new Error('markPlayerMissingThisRound: cannot mark a completed match');
  if (match.cancelled) throw new Error('markPlayerMissingThisRound: cannot mark a cancelled match');
  if (match.canalettoMissing) throw new Error('markPlayerMissingThisRound: match already has a missing-player designation');

  let opponent;
  if (match.p1.id === missingPlayerId) opponent = match.p2;
  else if (match.p2.id === missingPlayerId) opponent = match.p1;
  else throw new Error('markPlayerMissingThisRound: missingPlayerId is not a participant in this match');

  const newMatch = {
    ...match,
    p1: opponent,
    p2: { ...BYE_SENTINEL },
    r1: 0,
    r2: 0,
    done: true,
    cancelled: false,
    bye: true,
    canalettoMissing: { playerId: missingPlayerId, originalMatch: JSON.parse(JSON.stringify(match)) }
  };

  const updatedRound = round.map((m) => (m.id === matchId ? newMatch : m));
  const updatedRounds = { ...tournament.rounds, [tournament.currentRound]: updatedRound };

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      rounds: updatedRounds,
      players: recalcFrom(tournament, updatedRounds)
    }
  };
};

// Restores the ORIGINAL unplayed matchup exactly (not a new pairing) — only
// valid while the round is still current (checked by currentRoundMatch()
// above; a match from an earlier round is structurally unreachable here
// since currentRoundMatch() only ever looks at tournament.currentRound).
export const undoPlayerMissingThisRound = (applicationState, { matchId }) => {
  const tournament = applicationState?.tournament;
  if (!tournament) throw new Error('undoPlayerMissingThisRound: no tournament in this ApplicationState');
  if (tournament.started !== true) throw new Error('undoPlayerMissingThisRound: tournament has not started yet');

  const { round, match } = currentRoundMatch(tournament, matchId);
  if (!match.canalettoMissing) throw new Error('undoPlayerMissingThisRound: match has no missing-player designation to undo');

  const restoredMatch = match.canalettoMissing.originalMatch;
  const updatedRound = round.map((m) => (m.id === matchId ? restoredMatch : m));
  const updatedRounds = { ...tournament.rounds, [tournament.currentRound]: updatedRound };

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      rounds: updatedRounds,
      players: recalcFrom(tournament, updatedRounds)
    }
  };
};

// ---------------------------------------------------------------------------
// Reset current round
// ---------------------------------------------------------------------------
//
// Explicit, director-requested RE-PAIR of the CURRENT round only — NOT
// triggered by any score correction (score correction never re-pairs, per
// the hard product rule; this is a deliberately separate, explicit action).
//
// Erases: entered results/completions, missing-this-round designations, and
// manual pairing edits for the current round (all of these live ONLY inside
// that round's own match objects, so wholesale-replacing the current round
// erases all three at once — there is no separate state to hunt down).
//
// Rebuilds the current round from the tournament state immediately BEFORE
// it, by reusing reconstructStandingsBeforeRound() (roundLimit =
// currentRound — "strictly before currentRound", i.e. exactly the
// eligible-player/pre-round-standings state pairing should start from) and
// generatePairings() — the SAME domain functions every other pairing
// operation already uses. No pairing formula is reimplemented.
//
// BUG FIX: resetting ROUND 1 must reproduce the chosen Round 1 seed
// (cross_elo/random), not the generic MP -> PERF pairing order later rounds
// use. generatePairings()'s Round-1 direct-pairing branches ('cross_elo'/
// 'random'/'manual') do NOT sort the array themselves — they trust the
// caller already sorted it (exactly how startTournament() itself sorts
// tournament.roster by elo descending before calling generatePairings() for
// the real Round 1). A freshly-reset Round 1 has every player tied at
// MP=0/PERF=0, so sorting by compareFixedRackPairingOrder unconditionally
// (the previous behavior here) degenerated to id order — silently breaking
// cross_elo seeding. This mirrors startTournament()'s own sort-selection
// exactly, for Round 1 only; every other round is unaffected (generatePairings()
// ignores `seedMethod` entirely once roundNum !== 1, so the pairing-order
// sort below remains correct there, matching the existing, unchanged
// Round 2+ reset behavior).
// Guard: refuses if a LATER round already exists (rounds[currentRound + 1])
// — resetting would silently orphan already-generated later rounds, which
// this operation is not designed to touch or fix.
export const resetCurrentRound = (applicationState, { tableNumbers = [], seedMethod = null } = {}) => {
  const tournament = applicationState?.tournament;
  if (!tournament) throw new Error('resetCurrentRound: no tournament in this ApplicationState');
  if (tournament.started !== true) throw new Error('resetCurrentRound: tournament has not started yet');
  if (!tournament.rounds[tournament.currentRound]) {
    throw new Error(`resetCurrentRound: round ${tournament.currentRound} does not exist`);
  }
  if (tournament.rounds[tournament.currentRound + 1]) {
    throw new Error('resetCurrentRound: a later round already exists — cannot reset a round that has already been advanced past');
  }

  const preRoundStandings = reconstructStandingsBeforeRound({
    players: tournament.players,
    startingRoster: tournament.roster,
    rounds: tournament.rounds,
    roundLimit: tournament.currentRound,
    config: tournament.config
  });

  const eligible = Object.values(preRoundStandings).map((p) => ({ ...p, avgPerf: p.perfCount > 0 ? p.perf / p.perfCount : 0 }));

  let sorted;
  if (tournament.currentRound === 1 && (seedMethod === 'elo' || seedMethod === 'cross_elo')) {
    sorted = [...eligible].sort((a, b) => b.elo - a.elo);
  } else if (tournament.currentRound === 1 && seedMethod === 'random') {
    sorted = [...eligible].sort(() => Math.random() - 0.5);
  } else {
    // Round 2+ (seedMethod is irrelevant there), or Round 1 with no direct
    // seed method: the existing, unchanged Swiss/cost-based pairing order.
    sorted = [...eligible].sort(compareFixedRackPairingOrder);
  }

  // Bye history strictly before the round being reset — the round being
  // replaced must not count as its own prior bye history.
  const roundsBeforeCurrent = {};
  Object.entries(tournament.rounds).forEach(([key, matches]) => {
    if (Number(key) < tournament.currentRound) roundsBeforeCurrent[key] = matches;
  });

  const matches = generatePairings(sorted, {
    startTableIndex: 0,
    roundNum: tournament.currentRound,
    seedMethod,
    allRounds: roundsBeforeCurrent,
    tableNumbers,
    config: tournament.config
  });

  if (matches === null) {
    throw new Error('resetCurrentRound: no legal bye available when regenerating this round (whitepaper §9.2)');
  }

  const updatedRounds = { ...tournament.rounds, [tournament.currentRound]: matches };

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      rounds: updatedRounds,
      players: recalcFrom(tournament, updatedRounds)
    }
  };
};

// ---------------------------------------------------------------------------
// Manual pairing adjustment (current round only, uncompleted matches only)
// ---------------------------------------------------------------------------
//
// `pairings`: [{ matchId, p1Id, p2Id }], one entry per currently OPEN match
// (done: false, cancelled: false, bye: false) in the current round — every
// open-match player must appear in exactly one pairing entry, matched to
// exactly one match slot. Completed/cancelled/bye matches are structurally
// excluded from `openMatches` below and therefore CANNOT be touched by this
// function at all ("completed matches cannot silently be rewritten").
// Table assignments stay attached to their original match slot (`tbl` is
// preserved from the match being replaced, per matchId).
//
// Deliberately does NOT check for a repeat opponent — the director may
// intentionally accept one as an emergency override; that confirmation is a
// UI-level concern, not a data-layer rule.
export const applyManualPairings = (applicationState, { pairings }) => {
  const tournament = applicationState?.tournament;
  if (!tournament) throw new Error('applyManualPairings: no tournament in this ApplicationState');
  if (tournament.started !== true) throw new Error('applyManualPairings: tournament has not started yet');

  const round = tournament.rounds[tournament.currentRound];
  if (!round) throw new Error(`applyManualPairings: round ${tournament.currentRound} does not exist`);

  const openMatches = round.filter((m) => !m.done && !m.cancelled && !m.bye);
  if (!Array.isArray(pairings) || pairings.length !== openMatches.length) {
    throw new Error('applyManualPairings: pairings must cover exactly the current round\'s open (uncompleted) matches');
  }

  const snapshotById = new Map();
  openMatches.forEach((m) => {
    snapshotById.set(m.p1.id, m.p1);
    snapshotById.set(m.p2.id, m.p2);
  });
  const openPlayerIds = new Set(snapshotById.keys());
  const openMatchById = new Map(openMatches.map((m) => [m.id, m]));

  const usedMatchIds = new Set();
  const usedPlayerIds = new Set();
  const newMatchById = new Map();

  pairings.forEach(({ matchId, p1Id, p2Id }) => {
    const original = openMatchById.get(matchId);
    if (!original) throw new Error(`applyManualPairings: match ${matchId} is not an open match in the current round`);
    if (usedMatchIds.has(matchId)) throw new Error(`applyManualPairings: match ${matchId} is assigned more than once`);
    usedMatchIds.add(matchId);

    if (p1Id === p2Id) throw new Error('applyManualPairings: a match cannot pair a player against themselves');
    [p1Id, p2Id].forEach((id) => {
      if (!openPlayerIds.has(id)) throw new Error(`applyManualPairings: player ${id} is not part of this round's open matches`);
      if (usedPlayerIds.has(id)) throw new Error(`applyManualPairings: player ${id} is assigned to more than one match`);
      usedPlayerIds.add(id);
    });

    newMatchById.set(matchId, { ...original, p1: snapshotById.get(p1Id), p2: snapshotById.get(p2Id) });
  });

  if (usedMatchIds.size !== openMatches.length || usedPlayerIds.size !== openPlayerIds.size) {
    throw new Error('applyManualPairings: pairings must include every open match and every open-match player exactly once');
  }

  const updatedRound = round.map((m) => (newMatchById.has(m.id) ? newMatchById.get(m.id) : m));
  const updatedRounds = { ...tournament.rounds, [tournament.currentRound]: updatedRound };

  return {
    ...applicationState,
    tournament: {
      ...tournament,
      rounds: updatedRounds,
      players: recalcFrom(tournament, updatedRounds)
    }
  };
};
